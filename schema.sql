-- DineNiro schema. Applied on every server start, so every statement is idempotent.
-- Platform admins approve restaurants; staff accounts belong to one or more restaurants
-- through staff memberships, each with its own role.

-- 1. TABLES

-- Every account. 'admin' runs the platform; 'staff' works in restaurants (see staff_memberships).
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL DEFAULT '',
    role VARCHAR(16) NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_role CHECK (role IN ('admin', 'staff')),
    CONSTRAINT chk_users_username CHECK (username ~ '^[a-z0-9._-]{3,100}$'),
    CONSTRAINT chk_users_email CHECK (position('@' IN email) > 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));

-- A restaurant on the platform. It cannot operate until an admin approves it.
CREATE TABLE IF NOT EXISTS restaurants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address VARCHAR(500) NOT NULL,
    area VARCHAR(120) NOT NULL,
    city VARCHAR(120) NOT NULL,
    cuisine VARCHAR(120) NOT NULL DEFAULT '',
    trade_licence_no VARCHAR(100) NOT NULL DEFAULT '',
    vat_bin VARCHAR(100) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    status_reason TEXT NOT NULL DEFAULT '',
    created_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_restaurants_status CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'))
);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants (status);

-- Who works where, and as what. One row per person per restaurant.
CREATE TABLE IF NOT EXISTS staff_memberships (
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (restaurant_id, user_id),
    CONSTRAINT chk_staff_role CHECK (role IN ('owner', 'manager', 'waiter', 'chef', 'cashier', 'host'))
);
CREATE INDEX IF NOT EXISTS idx_staff_memberships_user ON staff_memberships (user_id);

-- Every restaurant status change, who made it and why.
CREATE TABLE IF NOT EXISTS restaurant_status_audit (
    id BIGSERIAL PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    old_status VARCHAR(16),
    new_status VARCHAR(16) NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    changed_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_restaurant_status_audit_restaurant ON restaurant_status_audit (restaurant_id, changed_at DESC);

-- Issued JWT IDs, so a session can be revoked immediately on logout.
CREATE TABLE IF NOT EXISTS auth_sessions (
    jti VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);

-- 2. INTEGRITY TRIGGERS

-- Record each status change. The acting admin is passed in with set_config('dineniro.actor_id', ...).
CREATE OR REPLACE FUNCTION log_restaurant_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO restaurant_status_audit (restaurant_id, old_status, new_status, reason, changed_by)
        VALUES (
            NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status,
            NEW.status_reason,
            NULLIF(current_setting('dineniro.actor_id', TRUE), '')
        );
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_restaurant_status_change ON restaurants;
CREATE TRIGGER trigger_restaurant_status_change
AFTER INSERT OR UPDATE OF status ON restaurants
FOR EACH ROW EXECUTE FUNCTION log_restaurant_status_change();

-- Staff memberships are for staff accounts only; platform admins never work inside a restaurant.
CREATE OR REPLACE FUNCTION enforce_membership_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT role FROM users WHERE id = NEW.user_id) IS DISTINCT FROM 'staff' THEN
        RAISE EXCEPTION 'Staff Error: only staff accounts can join a restaurant.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_membership_user_role ON staff_memberships;
CREATE TRIGGER trigger_membership_user_role
BEFORE INSERT OR UPDATE OF user_id ON staff_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_membership_user_role();

-- A restaurant must always keep at least one active owner.
CREATE OR REPLACE FUNCTION protect_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Removing or demoting an owner row: lock the restaurant's owners so two concurrent requests cannot both pass.
    IF OLD.role = 'owner' AND OLD.active AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NOT NEW.active) THEN
        PERFORM 1 FROM staff_memberships WHERE restaurant_id = OLD.restaurant_id AND role = 'owner' FOR UPDATE;
        IF NOT EXISTS (
            SELECT 1 FROM staff_memberships
            WHERE restaurant_id = OLD.restaurant_id AND role = 'owner' AND active AND user_id <> OLD.user_id
        ) AND EXISTS (SELECT 1 FROM restaurants WHERE id = OLD.restaurant_id) THEN
            RAISE EXCEPTION 'Staff Error: a restaurant must keep at least one active owner.';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_protect_last_owner ON staff_memberships;
CREATE TRIGGER trigger_protect_last_owner
BEFORE UPDATE OR DELETE ON staff_memberships
FOR EACH ROW EXECUTE FUNCTION protect_last_owner();

-- 3. FUNCTIONS USED BY THE API

CREATE OR REPLACE FUNCTION dineniro_database_status()
RETURNS TABLE(test INTEGER, db_name NAME, pg_version TEXT)
LANGUAGE SQL STABLE
AS $$
    SELECT 1, current_database(), version();
$$;

-- Accounts and authentication.
CREATE OR REPLACE FUNCTION dineniro_auth_user_lookup(p_identifier TEXT)
RETURNS SETOF users
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM users
    WHERE LOWER(username) = LOWER(p_identifier) OR LOWER(email) = LOWER(p_identifier)
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION dineniro_user_get(p_id VARCHAR)
RETURNS TABLE(id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE SQL STABLE
AS $$
    SELECT u.id, u.username, u.email, u.name, u.phone, u.role, u.created_at FROM users u WHERE u.id = p_id;
$$;

CREATE OR REPLACE FUNCTION dineniro_password_update(p_id VARCHAR, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE users SET password = p_password WHERE id = p_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_admin_create(p_id VARCHAR, p_username VARCHAR, p_email VARCHAR, p_password TEXT, p_name VARCHAR, p_phone VARCHAR)
RETURNS TABLE(id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(p_email)) THEN
        RAISE EXCEPTION USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_users_email_lower', MESSAGE = 'An account with this email already exists.';
    END IF;
    INSERT INTO users (id, username, email, password, name, phone, role)
    VALUES (p_id, LOWER(p_username), LOWER(p_email), p_password, p_name, p_phone, 'admin');
    RETURN QUERY SELECT * FROM dineniro_user_get(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_username_taken(p_username VARCHAR)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER(p_username));
$$;

CREATE OR REPLACE FUNCTION dineniro_admin_count()
RETURNS BIGINT
LANGUAGE SQL STABLE
AS $$
    SELECT COUNT(*) FROM users WHERE role = 'admin';
$$;

CREATE OR REPLACE FUNCTION dineniro_session_create(p_jti VARCHAR, p_user_id VARCHAR, p_expires_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP;
    INSERT INTO auth_sessions (jti, user_id, expires_at) VALUES (p_jti, p_user_id, p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_session_active(p_jti VARCHAR)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth_sessions
        WHERE jti = p_jti AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    );
$$;

CREATE OR REPLACE FUNCTION dineniro_session_revoke(p_jti VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE jti = p_jti AND revoked_at IS NULL;
    RETURN FOUND;
END;
$$;

-- Restaurants.
CREATE OR REPLACE FUNCTION dineniro_restaurant_get(p_id VARCHAR)
RETURNS SETOF restaurants
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM restaurants WHERE id = p_id;
$$;

-- A new owner applies: their account, the pending restaurant and their owner membership are created together.
CREATE OR REPLACE FUNCTION dineniro_restaurant_apply(
    p_user_id VARCHAR, p_username VARCHAR, p_email VARCHAR, p_password TEXT, p_owner_name VARCHAR, p_owner_phone VARCHAR,
    p_restaurant_id VARCHAR, p_name VARCHAR, p_phone VARCHAR, p_address VARCHAR, p_area VARCHAR, p_city VARCHAR,
    p_cuisine VARCHAR, p_trade_licence_no VARCHAR, p_vat_bin VARCHAR
)
RETURNS SETOF restaurants
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(p_email)) THEN
        RAISE EXCEPTION USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_users_email_lower', MESSAGE = 'An account with this email already exists.';
    END IF;
    INSERT INTO users (id, username, email, password, name, phone, role)
    VALUES (p_user_id, LOWER(p_username), LOWER(p_email), p_password, p_owner_name, p_owner_phone, 'staff');

    PERFORM set_config('dineniro.actor_id', p_user_id, TRUE);
    INSERT INTO restaurants (id, name, phone, address, area, city, cuisine, trade_licence_no, vat_bin, created_by)
    VALUES (p_restaurant_id, p_name, p_phone, p_address, p_area, p_city, p_cuisine, p_trade_licence_no, p_vat_bin, p_user_id);

    INSERT INTO staff_memberships (restaurant_id, user_id, role) VALUES (p_restaurant_id, p_user_id, 'owner');

    RETURN QUERY SELECT * FROM restaurants WHERE id = p_restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_restaurants_list(p_status VARCHAR DEFAULT NULL)
RETURNS TABLE(
    id VARCHAR, name VARCHAR, phone VARCHAR, address VARCHAR, area VARCHAR, city VARCHAR, cuisine VARCHAR,
    trade_licence_no VARCHAR, vat_bin VARCHAR, status VARCHAR, status_reason TEXT,
    created_at TIMESTAMPTZ, status_changed_at TIMESTAMPTZ,
    owner_name VARCHAR, owner_email VARCHAR, staff_count BIGINT
)
LANGUAGE SQL STABLE
AS $$
    SELECT r.id, r.name, r.phone, r.address, r.area, r.city, r.cuisine, r.trade_licence_no, r.vat_bin,
           r.status, r.status_reason, r.created_at, r.status_changed_at,
           owner.name, owner.email,
           (SELECT COUNT(*) FROM staff_memberships m WHERE m.restaurant_id = r.id AND m.active)
    FROM restaurants r
    LEFT JOIN LATERAL (
        SELECT u.name, u.email FROM staff_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.restaurant_id = r.id AND m.role = 'owner'
        ORDER BY m.created_at LIMIT 1
    ) owner ON TRUE
    WHERE p_status IS NULL OR r.status = p_status
    ORDER BY r.created_at DESC;
$$;

-- Allowed moves: pending -> approved | rejected, approved -> suspended, suspended -> approved, rejected -> pending.
CREATE OR REPLACE FUNCTION dineniro_restaurant_status_update(p_id VARCHAR, p_status VARCHAR, p_reason TEXT, p_actor_id VARCHAR)
RETURNS SETOF restaurants
LANGUAGE plpgsql
AS $$
DECLARE
    v_current VARCHAR;
BEGIN
    SELECT status INTO v_current FROM restaurants WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF NOT (
        (v_current = 'pending' AND p_status IN ('approved', 'rejected')) OR
        (v_current = 'approved' AND p_status = 'suspended') OR
        (v_current = 'suspended' AND p_status = 'approved') OR
        (v_current = 'rejected' AND p_status = 'pending')
    ) THEN
        RAISE EXCEPTION 'Status Error: a % restaurant cannot be moved to %.', v_current, p_status;
    END IF;

    IF p_status IN ('rejected', 'suspended') AND COALESCE(TRIM(p_reason), '') = '' THEN
        RAISE EXCEPTION 'Status Error: give a reason when a restaurant is %.', p_status;
    END IF;

    PERFORM set_config('dineniro.actor_id', COALESCE(p_actor_id, ''), TRUE);
    UPDATE restaurants
    SET status = p_status, status_reason = COALESCE(TRIM(p_reason), ''), status_changed_at = CURRENT_TIMESTAMP
    WHERE id = p_id;

    RETURN QUERY SELECT * FROM restaurants WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_restaurant_audit(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(
    id BIGINT, restaurant_id VARCHAR, restaurant_name VARCHAR, old_status VARCHAR, new_status VARCHAR,
    reason TEXT, changed_by_name VARCHAR, changed_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE
AS $$
    SELECT a.id, a.restaurant_id, r.name, a.old_status, a.new_status, a.reason, u.name, a.changed_at
    FROM restaurant_status_audit a
    JOIN restaurants r ON r.id = a.restaurant_id
    LEFT JOIN users u ON u.id = a.changed_by
    ORDER BY a.changed_at DESC, a.id DESC
    LIMIT GREATEST(LEAST(p_limit, 200), 0);
$$;

CREATE OR REPLACE FUNCTION dineniro_admin_stats()
RETURNS TABLE(pending BIGINT, approved BIGINT, suspended BIGINT, rejected BIGINT, active_staff BIGINT)
LANGUAGE SQL STABLE
AS $$
    SELECT
        COUNT(*) FILTER (WHERE status = 'pending'),
        COUNT(*) FILTER (WHERE status = 'approved'),
        COUNT(*) FILTER (WHERE status = 'suspended'),
        COUNT(*) FILTER (WHERE status = 'rejected'),
        (SELECT COUNT(DISTINCT user_id) FROM staff_memberships WHERE active)
    FROM restaurants;
$$;

-- Staff memberships.
CREATE OR REPLACE FUNCTION dineniro_memberships_for_user(p_user_id VARCHAR)
RETURNS TABLE(restaurant_id VARCHAR, restaurant_name VARCHAR, restaurant_status VARCHAR, status_reason TEXT, role VARCHAR)
LANGUAGE SQL STABLE
AS $$
    SELECT r.id, r.name, r.status, r.status_reason, m.role
    FROM staff_memberships m JOIN restaurants r ON r.id = m.restaurant_id
    WHERE m.user_id = p_user_id AND m.active
    ORDER BY r.name;
$$;

CREATE OR REPLACE FUNCTION dineniro_membership_get(p_user_id VARCHAR, p_restaurant_id VARCHAR)
RETURNS TABLE(restaurant_id VARCHAR, restaurant_status VARCHAR, role VARCHAR)
LANGUAGE SQL STABLE
AS $$
    SELECT r.id, r.status, m.role
    FROM staff_memberships m JOIN restaurants r ON r.id = m.restaurant_id
    WHERE m.user_id = p_user_id AND m.restaurant_id = p_restaurant_id AND m.active;
$$;

CREATE OR REPLACE FUNCTION dineniro_staff_list(p_restaurant_id VARCHAR)
RETURNS TABLE(user_id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, active BOOLEAN, joined_at TIMESTAMPTZ)
LANGUAGE SQL STABLE
AS $$
    SELECT u.id, u.username, u.email, u.name, u.phone, m.role, m.active, m.created_at
    FROM staff_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.restaurant_id = p_restaurant_id
    ORDER BY m.active DESC,
             array_position(ARRAY['owner', 'manager', 'cashier', 'host', 'waiter', 'chef']::VARCHAR[], m.role),
             u.name;
$$;

CREATE OR REPLACE FUNCTION dineniro_staff_member_get(p_restaurant_id VARCHAR, p_user_id VARCHAR)
RETURNS TABLE(user_id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, active BOOLEAN, joined_at TIMESTAMPTZ)
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM dineniro_staff_list(p_restaurant_id) s WHERE s.user_id = p_user_id;
$$;

-- Adds a new staff account to a restaurant, or links an existing staff account found by email.
-- An existing account keeps its own password; p_password is only used for a new one.
CREATE OR REPLACE FUNCTION dineniro_staff_add(
    p_restaurant_id VARCHAR, p_new_user_id VARCHAR, p_username VARCHAR, p_email VARCHAR,
    p_password TEXT, p_name VARCHAR, p_phone VARCHAR, p_role VARCHAR
)
RETURNS TABLE(user_id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, active BOOLEAN, joined_at TIMESTAMPTZ, created_account BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id VARCHAR;
    v_created BOOLEAN := FALSE;
BEGIN
    SELECT u.id INTO v_user_id FROM users u WHERE LOWER(u.email) = LOWER(p_email);
    IF v_user_id IS NULL THEN
        IF p_password IS NULL OR p_password = '' THEN
            RAISE EXCEPTION 'Staff Error: a password is required for a new staff account.';
        END IF;
        INSERT INTO users (id, username, email, password, name, phone, role)
        VALUES (p_new_user_id, LOWER(p_username), LOWER(p_email), p_password, p_name, p_phone, 'staff');
        v_user_id := p_new_user_id;
        v_created := TRUE;
    END IF;

    INSERT INTO staff_memberships (restaurant_id, user_id, role) VALUES (p_restaurant_id, v_user_id, p_role);

    RETURN QUERY SELECT s.*, v_created FROM dineniro_staff_member_get(p_restaurant_id, v_user_id) s;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_staff_update(p_restaurant_id VARCHAR, p_user_id VARCHAR, p_role VARCHAR, p_active BOOLEAN)
RETURNS TABLE(user_id VARCHAR, username VARCHAR, email VARCHAR, name VARCHAR, phone VARCHAR, role VARCHAR, active BOOLEAN, joined_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE staff_memberships m
    SET role = COALESCE(p_role, m.role), active = COALESCE(p_active, m.active)
    WHERE m.restaurant_id = p_restaurant_id AND m.user_id = p_user_id;
    RETURN QUERY SELECT * FROM dineniro_staff_member_get(p_restaurant_id, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_staff_remove(p_restaurant_id VARCHAR, p_user_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM staff_memberships WHERE restaurant_id = p_restaurant_id AND user_id = p_user_id;
    RETURN FOUND;
END;
$$;


-- 4. SERVICE: TABLES, MENU, ORDERS, KITCHEN, BILLING
-- Every row belongs to one restaurant. Composite foreign keys on (restaurant_id, id) make it impossible
-- for an order to point at another restaurant's table, or an order line at another restaurant's dish.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_charge_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS vat_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS receipt_footer VARCHAR(300) NOT NULL DEFAULT '';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_restaurants_rates') THEN
        ALTER TABLE restaurants ADD CONSTRAINT chk_restaurants_rates
            CHECK (service_charge_pct BETWEEN 0 AND 30 AND vat_pct BETWEEN 0 AND 30);
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS dining_tables (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    label VARCHAR(20) NOT NULL,
    seats INTEGER NOT NULL,
    section VARCHAR(60) NOT NULL DEFAULT 'Main hall',
    shape VARCHAR(10) NOT NULL DEFAULT 'square',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_dining_tables_restaurant_id UNIQUE (restaurant_id, id),
    CONSTRAINT chk_dining_tables_seats CHECK (seats BETWEEN 1 AND 40),
    CONSTRAINT chk_dining_tables_shape CHECK (shape IN ('square', 'round', 'long'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dining_tables_label ON dining_tables (restaurant_id, LOWER(label));

CREATE TABLE IF NOT EXISTS menu_categories (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_menu_categories_restaurant_id UNIQUE (restaurant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_categories_name ON menu_categories (restaurant_id, LOWER(name));

CREATE TABLE IF NOT EXISTS menu_items (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    category_id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(300) NOT NULL DEFAULT '',
    price NUMERIC(10,2) NOT NULL,
    station VARCHAR(20) NOT NULL DEFAULT 'kitchen',
    available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_menu_items_restaurant_id UNIQUE (restaurant_id, id),
    CONSTRAINT fk_menu_items_category FOREIGN KEY (restaurant_id, category_id)
        REFERENCES menu_categories (restaurant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_menu_items_price CHECK (price >= 0 AND price < 1000000),
    CONSTRAINT chk_menu_items_station CHECK (station IN ('kitchen', 'tandoor', 'bar', 'dessert'))
);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items (restaurant_id, category_id);

-- Choices on a dish ("Extra aloo +30", "Less oil"). Each adds its price_delta to the line price.
CREATE TABLE IF NOT EXISTS menu_item_options (
    id VARCHAR(64) PRIMARY KEY,
    menu_item_id VARCHAR(64) NOT NULL REFERENCES menu_items(id) ON UPDATE CASCADE ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    price_delta NUMERIC(10,2) NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT chk_menu_item_options_delta CHECK (price_delta >= 0 AND price_delta < 100000)
);
CREATE INDEX IF NOT EXISTS idx_menu_item_options_item ON menu_item_options (menu_item_id);

-- One visit to one table: open while eating, billed once the bill is printed, paid when settled.
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    table_id VARCHAR(64) NOT NULL,
    guests INTEGER NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open',
    opened_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    CONSTRAINT uq_orders_restaurant_id UNIQUE (restaurant_id, id),
    CONSTRAINT fk_orders_table FOREIGN KEY (restaurant_id, table_id)
        REFERENCES dining_tables (restaurant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_orders_guests CHECK (guests BETWEEN 1 AND 60),
    CONSTRAINT chk_orders_status CHECK (status IN ('open', 'billed', 'paid', 'void'))
);
-- A table can only have one visit in progress.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_active_table ON orders (table_id) WHERE status IN ('open', 'billed');
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON orders (restaurant_id, status);

-- Food sent to the kitchen together. Moves new -> cooking -> ready -> served.
CREATE TABLE IF NOT EXISTS kitchen_tickets (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    number INTEGER NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'new',
    sent_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    CONSTRAINT fk_kitchen_tickets_order FOREIGN KEY (restaurant_id, order_id)
        REFERENCES orders (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_kitchen_tickets_number UNIQUE (restaurant_id, number),
    CONSTRAINT chk_kitchen_tickets_status CHECK (status IN ('new', 'cooking', 'ready', 'served'))
);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_active ON kitchen_tickets (restaurant_id, status) WHERE status <> 'served';

-- What was ordered. Name and price are copied from the menu, so later menu edits never change a past order.
CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    menu_item_id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    note VARCHAR(200) NOT NULL DEFAULT '',
    station VARCHAR(20) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'draft',
    ticket_id VARCHAR(64) REFERENCES kitchen_tickets(id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    void_reason VARCHAR(200) NOT NULL DEFAULT '',
    voided_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_order_items_order FOREIGN KEY (restaurant_id, order_id)
        REFERENCES orders (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_items_menu_item FOREIGN KEY (restaurant_id, menu_item_id)
        REFERENCES menu_items (restaurant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_order_items_quantity CHECK (quantity BETWEEN 1 AND 99),
    CONSTRAINT chk_order_items_status CHECK (status IN ('draft', 'sent', 'void'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_ticket ON order_items (ticket_id);

-- The bill for a visit. Amounts are fixed when it is printed; adding food afterwards reopens it.
CREATE TABLE IF NOT EXISTS bills (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    number INTEGER NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    service_charge_pct NUMERIC(5,2) NOT NULL,
    service_charge NUMERIC(12,2) NOT NULL,
    vat_pct NUMERIC(5,2) NOT NULL,
    vat NUMERIC(12,2) NOT NULL,
    total NUMERIC(12,2) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open',
    created_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    CONSTRAINT uq_bills_restaurant_id UNIQUE (restaurant_id, id),
    CONSTRAINT uq_bills_order UNIQUE (order_id),
    CONSTRAINT uq_bills_number UNIQUE (restaurant_id, number),
    CONSTRAINT fk_bills_order FOREIGN KEY (restaurant_id, order_id)
        REFERENCES orders (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_bills_amounts CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND total >= 0),
    CONSTRAINT chk_bills_status CHECK (status IN ('open', 'paid'))
);

CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    bill_id VARCHAR(64) NOT NULL,
    method VARCHAR(10) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    tendered NUMERIC(12,2),
    reference VARCHAR(100) NOT NULL DEFAULT '',
    received_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payments_bill FOREIGN KEY (restaurant_id, bill_id)
        REFERENCES bills (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_payments_method CHECK (method IN ('cash', 'card', 'bkash', 'nagad')),
    CONSTRAINT chk_payments_amount CHECK (amount > 0 AND (tendered IS NULL OR tendered >= amount))
);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments (bill_id);

-- 5. SERVICE FUNCTIONS. Each takes the restaurant ID first and only ever touches that restaurant's rows.

CREATE OR REPLACE FUNCTION dineniro_settings_update(p_restaurant_id VARCHAR, p_service_pct NUMERIC, p_vat_pct NUMERIC, p_footer VARCHAR)
RETURNS SETOF restaurants
LANGUAGE SQL
AS $$
    UPDATE restaurants
    SET service_charge_pct = COALESCE(p_service_pct, service_charge_pct),
        vat_pct = COALESCE(p_vat_pct, vat_pct),
        receipt_footer = COALESCE(p_footer, receipt_footer)
    WHERE id = p_restaurant_id
    RETURNING *;
$$;

-- Tables.
CREATE OR REPLACE FUNCTION dineniro_tables_list(p_restaurant_id VARCHAR)
RETURNS SETOF dining_tables
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM dining_tables WHERE restaurant_id = p_restaurant_id ORDER BY section, sort_order, label;
$$;

CREATE OR REPLACE FUNCTION dineniro_table_save(
    p_restaurant_id VARCHAR, p_id VARCHAR, p_label VARCHAR, p_seats INTEGER, p_section VARCHAR,
    p_shape VARCHAR, p_sort_order INTEGER, p_active BOOLEAN
)
RETURNS SETOF dining_tables
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_active = FALSE AND EXISTS (
        SELECT 1 FROM orders WHERE restaurant_id = p_restaurant_id AND table_id = p_id AND status IN ('open', 'billed')
    ) THEN
        RAISE EXCEPTION 'Service Error: guests are still at this table. Settle the bill first.';
    END IF;
    INSERT INTO dining_tables (id, restaurant_id, label, seats, section, shape, sort_order, active)
    VALUES (p_id, p_restaurant_id, p_label, p_seats, COALESCE(p_section, 'Main hall'), COALESCE(p_shape, 'square'), COALESCE(p_sort_order, 0), COALESCE(p_active, TRUE))
    ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label, seats = EXCLUDED.seats, section = EXCLUDED.section, shape = EXCLUDED.shape,
        sort_order = EXCLUDED.sort_order, active = EXCLUDED.active
    WHERE dining_tables.restaurant_id = p_restaurant_id;
    RETURN QUERY SELECT * FROM dining_tables WHERE id = p_id AND restaurant_id = p_restaurant_id;
END;
$$;

-- Menu (dineniro_menu is defined with inventory below, because it reports portions left).
CREATE OR REPLACE FUNCTION dineniro_category_save(p_restaurant_id VARCHAR, p_id VARCHAR, p_name VARCHAR, p_sort_order INTEGER)
RETURNS SETOF menu_categories
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO menu_categories (id, restaurant_id, name, sort_order)
    VALUES (p_id, p_restaurant_id, p_name, COALESCE(p_sort_order, 0))
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
    WHERE menu_categories.restaurant_id = p_restaurant_id;
    RETURN QUERY SELECT * FROM menu_categories WHERE id = p_id AND restaurant_id = p_restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_category_delete(p_restaurant_id VARCHAR, p_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM menu_items WHERE restaurant_id = p_restaurant_id AND category_id = p_id) THEN
        RAISE EXCEPTION 'Service Error: move or remove the dishes in this category first.';
    END IF;
    DELETE FROM menu_categories WHERE restaurant_id = p_restaurant_id AND id = p_id;
    RETURN FOUND;
END;
$$;

-- Saves a dish and replaces its options with p_options: [{ "id", "name", "priceDelta" }].
CREATE OR REPLACE FUNCTION dineniro_menu_item_save(
    p_restaurant_id VARCHAR, p_id VARCHAR, p_category_id VARCHAR, p_name VARCHAR, p_description VARCHAR,
    p_price NUMERIC, p_station VARCHAR, p_available BOOLEAN, p_sort_order INTEGER, p_options JSONB
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price, station, available, sort_order)
    VALUES (p_id, p_restaurant_id, p_category_id, p_name, COALESCE(p_description, ''), p_price,
            COALESCE(p_station, 'kitchen'), COALESCE(p_available, TRUE), COALESCE(p_sort_order, 0))
    ON CONFLICT (id) DO UPDATE SET
        category_id = EXCLUDED.category_id, name = EXCLUDED.name, description = EXCLUDED.description,
        price = EXCLUDED.price, station = EXCLUDED.station, available = EXCLUDED.available, sort_order = EXCLUDED.sort_order
    WHERE menu_items.restaurant_id = p_restaurant_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF p_options IS NOT NULL THEN
        DELETE FROM menu_item_options WHERE menu_item_id = p_id;
        INSERT INTO menu_item_options (id, menu_item_id, name, price_delta, sort_order)
        SELECT opt.value->>'id', p_id, opt.value->>'name', COALESCE((opt.value->>'priceDelta')::NUMERIC, 0), opt.ordinality::INTEGER
        FROM jsonb_array_elements(p_options) WITH ORDINALITY AS opt(value, ordinality);
    END IF;
    RETURN p_id;
END;
$$;

-- Orders.
CREATE OR REPLACE FUNCTION dineniro_order_open(p_restaurant_id VARCHAR, p_id VARCHAR, p_table_id VARCHAR, p_guests INTEGER, p_user_id VARCHAR)
RETURNS SETOF orders
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = p_restaurant_id AND id = p_table_id AND active) THEN
        RAISE EXCEPTION 'Service Error: that table is not on the floor.';
    END IF;
    IF EXISTS (SELECT 1 FROM orders WHERE table_id = p_table_id AND status IN ('open', 'billed')) THEN
        RAISE EXCEPTION 'Service Error: this table is already seated.';
    END IF;
    INSERT INTO orders (id, restaurant_id, table_id, guests, opened_by) VALUES (p_id, p_restaurant_id, p_table_id, p_guests, p_user_id);
    RETURN QUERY SELECT * FROM orders WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_order_get(p_restaurant_id VARCHAR, p_order_id VARCHAR)
RETURNS TABLE(
    id VARCHAR, table_id VARCHAR, table_label VARCHAR, guests INTEGER, status VARCHAR,
    opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, server_name VARCHAR, bill_id VARCHAR
)
LANGUAGE SQL STABLE
AS $$
    SELECT o.id, o.table_id, t.label, o.guests, o.status, o.opened_at, o.closed_at, u.name, b.id
    FROM orders o
    JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.opened_by
    LEFT JOIN bills b ON b.order_id = o.id
    WHERE o.restaurant_id = p_restaurant_id AND o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION dineniro_order_items(p_restaurant_id VARCHAR, p_order_id VARCHAR)
RETURNS TABLE(
    id VARCHAR, menu_item_id VARCHAR, name VARCHAR, unit_price NUMERIC, quantity INTEGER, options JSONB, note VARCHAR,
    station VARCHAR, status VARCHAR, ticket_status VARCHAR, void_reason VARCHAR, created_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE
AS $$
    SELECT i.id, i.menu_item_id, i.name, i.unit_price, i.quantity, i.options, i.note, i.station, i.status, k.status, i.void_reason, i.created_at
    FROM order_items i LEFT JOIN kitchen_tickets k ON k.id = i.ticket_id
    WHERE i.restaurant_id = p_restaurant_id AND i.order_id = p_order_id
    ORDER BY i.created_at, i.id;
$$;

-- Locks the order and refuses changes once it is paid or void. A billed order with no payments goes back to open,
-- and its bill is dropped, because the food on it is changing.
CREATE OR REPLACE FUNCTION dineniro_order_lock_for_change(p_restaurant_id VARCHAR, p_order_id VARCHAR)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM orders WHERE restaurant_id = p_restaurant_id AND id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service Error: order not found.'; END IF;
    IF v_status IN ('paid', 'void') THEN RAISE EXCEPTION 'Service Error: this order is closed.'; END IF;
    IF v_status = 'billed' THEN
        IF EXISTS (SELECT 1 FROM payments p JOIN bills b ON b.id = p.bill_id WHERE b.order_id = p_order_id) THEN
            RAISE EXCEPTION 'Service Error: part of the bill is already paid. Settle it before changing the order.';
        END IF;
        DELETE FROM bills WHERE order_id = p_order_id;
        UPDATE orders SET status = 'open' WHERE id = p_order_id;
    END IF;
END;
$$;

-- Adds a dish as a draft line. p_option_ids must be options of that dish; their prices are added to the line.
CREATE OR REPLACE FUNCTION dineniro_order_item_add(
    p_restaurant_id VARCHAR, p_order_id VARCHAR, p_id VARCHAR, p_menu_item_id VARCHAR, p_quantity INTEGER,
    p_option_ids JSONB, p_note VARCHAR, p_user_id VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_item menu_items%ROWTYPE;
    v_options JSONB;
    v_delta NUMERIC;
    v_option_count INTEGER;
    v_existing VARCHAR;
BEGIN
    PERFORM dineniro_order_lock_for_change(p_restaurant_id, p_order_id);
    SELECT * INTO v_item FROM menu_items WHERE restaurant_id = p_restaurant_id AND id = p_menu_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service Error: that dish is not on the menu.'; END IF;
    IF NOT v_item.available THEN RAISE EXCEPTION 'Service Error: % is sold out.', v_item.name; END IF;

    SELECT COALESCE(jsonb_agg(o.name ORDER BY o.sort_order), '[]'::JSONB), COALESCE(SUM(o.price_delta), 0), COUNT(*)
    INTO v_options, v_delta, v_option_count
    FROM menu_item_options o
    WHERE o.menu_item_id = v_item.id AND o.id IN (SELECT jsonb_array_elements_text(COALESCE(p_option_ids, '[]'::JSONB)));
    IF v_option_count <> (SELECT COUNT(DISTINCT x) FROM jsonb_array_elements_text(COALESCE(p_option_ids, '[]'::JSONB)) x) THEN
        RAISE EXCEPTION 'Service Error: one of the chosen options does not belong to %.', v_item.name;
    END IF;

    -- Tapping the same dish again adds to the unsent line instead of starting a new one.
    UPDATE order_items SET quantity = LEAST(quantity + p_quantity, 99)
    WHERE id = (
        SELECT id FROM order_items
        WHERE order_id = p_order_id AND status = 'draft' AND menu_item_id = v_item.id
          AND options = v_options AND note = COALESCE(p_note, '')
        ORDER BY created_at LIMIT 1
    )
    RETURNING id INTO v_existing;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

    INSERT INTO order_items (id, restaurant_id, order_id, menu_item_id, name, unit_price, quantity, options, note, station, added_by)
    VALUES (p_id, p_restaurant_id, p_order_id, v_item.id, v_item.name, v_item.price + v_delta, p_quantity, v_options,
            COALESCE(p_note, ''), v_item.station, p_user_id);
    RETURN p_id;
END;
$$;

-- Changes the quantity of an unsent line, or removes it when p_quantity is 0.
CREATE OR REPLACE FUNCTION dineniro_order_item_set_quantity(p_restaurant_id VARCHAR, p_order_id VARCHAR, p_item_id VARCHAR, p_quantity INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM dineniro_order_lock_for_change(p_restaurant_id, p_order_id);
    IF NOT EXISTS (SELECT 1 FROM order_items WHERE restaurant_id = p_restaurant_id AND order_id = p_order_id AND id = p_item_id) THEN
        RETURN FALSE;
    END IF;
    IF EXISTS (SELECT 1 FROM order_items WHERE id = p_item_id AND status <> 'draft') THEN
        RAISE EXCEPTION 'Service Error: this dish has already gone to the kitchen. A manager can void it instead.';
    END IF;
    IF p_quantity = 0 THEN
        DELETE FROM order_items WHERE id = p_item_id;
    ELSE
        UPDATE order_items SET quantity = p_quantity WHERE id = p_item_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- Voids a line that already went to the kitchen. It stays on record with the reason but is not billed.
CREATE OR REPLACE FUNCTION dineniro_order_item_void(p_restaurant_id VARCHAR, p_order_id VARCHAR, p_item_id VARCHAR, p_reason VARCHAR, p_user_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Service Error: give a reason for the void.'; END IF;
    PERFORM dineniro_order_lock_for_change(p_restaurant_id, p_order_id);
    UPDATE order_items SET status = 'void', void_reason = TRIM(p_reason), voided_by = p_user_id
    WHERE restaurant_id = p_restaurant_id AND order_id = p_order_id AND id = p_item_id AND status = 'sent';
    IF NOT FOUND THEN RETURN FALSE; END IF;
    -- A ticket with nothing left to cook closes itself, so the kitchen and the floor stop showing it.
    UPDATE kitchen_tickets k SET status = 'served', served_at = COALESCE(k.served_at, CURRENT_TIMESTAMP)
    WHERE k.id = (SELECT ticket_id FROM order_items WHERE id = p_item_id) AND k.status <> 'served'
      AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.ticket_id = k.id AND i.status <> 'void');
    RETURN TRUE;
END;
$$;

-- Sends every draft line to the kitchen as one ticket.
CREATE OR REPLACE FUNCTION dineniro_order_send(p_restaurant_id VARCHAR, p_order_id VARCHAR, p_ticket_id VARCHAR, p_user_id VARCHAR)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_number INTEGER;
BEGIN
    PERFORM dineniro_order_lock_for_change(p_restaurant_id, p_order_id);
    IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id AND status = 'draft') THEN
        RAISE EXCEPTION 'Service Error: add a dish before sending to the kitchen.';
    END IF;
    PERFORM 1 FROM restaurants WHERE id = p_restaurant_id FOR UPDATE; -- serialises ticket numbers
    SELECT COALESCE(MAX(number), 0) + 1 INTO v_number FROM kitchen_tickets WHERE restaurant_id = p_restaurant_id;
    INSERT INTO kitchen_tickets (id, restaurant_id, order_id, number, sent_by) VALUES (p_ticket_id, p_restaurant_id, p_order_id, v_number, p_user_id);
    UPDATE order_items SET status = 'sent', ticket_id = p_ticket_id WHERE order_id = p_order_id AND status = 'draft';
    RETURN v_number;
END;
$$;

-- Cancels a visit where nothing reached the kitchen, e.g. guests who left before ordering.
CREATE OR REPLACE FUNCTION dineniro_order_void(p_restaurant_id VARCHAR, p_order_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM dineniro_order_lock_for_change(p_restaurant_id, p_order_id);
    IF EXISTS (SELECT 1 FROM kitchen_tickets WHERE order_id = p_order_id) THEN
        RAISE EXCEPTION 'Service Error: food has already gone to the kitchen. Bill the table or void the dishes instead.';
    END IF;
    DELETE FROM order_items WHERE order_id = p_order_id;
    UPDATE orders SET status = 'void', closed_at = CURRENT_TIMESTAMP WHERE id = p_order_id;
    RETURN TRUE;
END;
$$;

-- Kitchen.
CREATE OR REPLACE FUNCTION dineniro_kitchen_tickets(p_restaurant_id VARCHAR)
RETURNS TABLE(
    id VARCHAR, number INTEGER, status VARCHAR, order_id VARCHAR, table_label VARCHAR, server_name VARCHAR,
    sent_at TIMESTAMPTZ, started_at TIMESTAMPTZ, ready_at TIMESTAMPTZ, items JSONB
)
LANGUAGE SQL STABLE
AS $$
    SELECT k.id, k.number, k.status, k.order_id, t.label, u.name, k.sent_at, k.started_at, k.ready_at,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                   'id', i.id, 'name', i.name, 'quantity', i.quantity, 'options', i.options, 'note', i.note,
                   'station', i.station, 'void', i.status = 'void'
               ) ORDER BY i.created_at, i.id)
               FROM order_items i WHERE i.ticket_id = k.id
           ), '[]'::JSONB)
    FROM kitchen_tickets k
    JOIN orders o ON o.id = k.order_id
    JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = k.sent_by
    WHERE k.restaurant_id = p_restaurant_id
      AND (k.status <> 'served' OR k.served_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes')
    ORDER BY k.sent_at, k.number;
$$;

-- Moves a ticket one step on. p_from must match its current status, so two cooks tapping at once cannot skip a step.
CREATE OR REPLACE FUNCTION dineniro_ticket_advance(p_restaurant_id VARCHAR, p_ticket_id VARCHAR, p_from VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_next VARCHAR := CASE p_from WHEN 'new' THEN 'cooking' WHEN 'cooking' THEN 'ready' WHEN 'ready' THEN 'served' END;
BEGIN
    IF v_next IS NULL THEN RAISE EXCEPTION 'Service Error: this ticket is already served.'; END IF;
    UPDATE kitchen_tickets SET
        status = v_next,
        started_at = CASE WHEN v_next = 'cooking' THEN CURRENT_TIMESTAMP ELSE started_at END,
        ready_at = CASE WHEN v_next = 'ready' THEN CURRENT_TIMESTAMP ELSE ready_at END,
        served_at = CASE WHEN v_next = 'served' THEN CURRENT_TIMESTAMP ELSE served_at END
    WHERE restaurant_id = p_restaurant_id AND id = p_ticket_id AND status = p_from;
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM kitchen_tickets WHERE restaurant_id = p_restaurant_id AND id = p_ticket_id) THEN
            RAISE EXCEPTION 'Service Error: someone already moved this ticket. The screen will refresh.';
        END IF;
        RETURN NULL;
    END IF;
    RETURN v_next;
END;
$$;

-- Billing. Discount comes off the food subtotal; service charge is on the discounted subtotal;
-- VAT is on the discounted subtotal plus service charge. Every amount is rounded to the paisa.
CREATE OR REPLACE FUNCTION dineniro_bill_prepare(p_restaurant_id VARCHAR, p_order_id VARCHAR, p_bill_id VARCHAR, p_discount NUMERIC, p_user_id VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR;
    v_bill_id VARCHAR;
    v_subtotal NUMERIC;
    v_discount NUMERIC := COALESCE(p_discount, 0);
    v_service_pct NUMERIC;
    v_vat_pct NUMERIC;
    v_service NUMERIC;
    v_vat NUMERIC;
    v_number INTEGER;
BEGIN
    SELECT status INTO v_status FROM orders WHERE restaurant_id = p_restaurant_id AND id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_status IN ('paid', 'void') THEN RAISE EXCEPTION 'Service Error: this order is closed.'; END IF;
    IF EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id AND status = 'draft') THEN
        RAISE EXCEPTION 'Service Error: send or remove the dishes that have not gone to the kitchen yet.';
    END IF;

    SELECT id INTO v_bill_id FROM bills WHERE order_id = p_order_id;
    IF v_bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments WHERE bill_id = v_bill_id) THEN
        RAISE EXCEPTION 'Service Error: payments have started on this bill, so it cannot be changed.';
    END IF;

    SELECT COALESCE(SUM(unit_price * quantity), 0) INTO v_subtotal FROM order_items WHERE order_id = p_order_id AND status = 'sent';
    IF v_subtotal = 0 THEN RAISE EXCEPTION 'Service Error: there is nothing to bill.'; END IF;
    IF v_discount < 0 OR v_discount > v_subtotal THEN RAISE EXCEPTION 'Service Error: the discount must be between 0 and the food total.'; END IF;

    SELECT service_charge_pct, vat_pct INTO v_service_pct, v_vat_pct FROM restaurants WHERE id = p_restaurant_id FOR UPDATE;
    v_service := ROUND((v_subtotal - v_discount) * v_service_pct / 100, 2);
    v_vat := ROUND((v_subtotal - v_discount + v_service) * v_vat_pct / 100, 2);

    IF v_bill_id IS NULL THEN
        SELECT COALESCE(MAX(number), 0) + 1 INTO v_number FROM bills WHERE restaurant_id = p_restaurant_id;
        v_bill_id := p_bill_id;
        INSERT INTO bills (id, restaurant_id, order_id, number, subtotal, discount, service_charge_pct, service_charge, vat_pct, vat, total, created_by)
        VALUES (v_bill_id, p_restaurant_id, p_order_id, v_number, v_subtotal, v_discount, v_service_pct, v_service, v_vat_pct, v_vat,
                v_subtotal - v_discount + v_service + v_vat, p_user_id);
    ELSE
        UPDATE bills SET subtotal = v_subtotal, discount = v_discount, service_charge_pct = v_service_pct, service_charge = v_service,
            vat_pct = v_vat_pct, vat = v_vat, total = v_subtotal - v_discount + v_service + v_vat
        WHERE id = v_bill_id;
    END IF;
    UPDATE orders SET status = 'billed' WHERE id = p_order_id;
    RETURN v_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_bill_get(p_restaurant_id VARCHAR, p_bill_id VARCHAR)
RETURNS TABLE(
    id VARCHAR, order_id VARCHAR, number INTEGER, subtotal NUMERIC, discount NUMERIC, service_charge_pct NUMERIC,
    service_charge NUMERIC, vat_pct NUMERIC, vat NUMERIC, total NUMERIC, paid NUMERIC, status VARCHAR,
    created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, table_label VARCHAR, guests INTEGER, server_name VARCHAR, payments JSONB
)
LANGUAGE SQL STABLE
AS $$
    SELECT b.id, b.order_id, b.number, b.subtotal, b.discount, b.service_charge_pct, b.service_charge, b.vat_pct, b.vat, b.total,
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id = b.id), 0),
           b.status, b.created_at, b.paid_at, t.label, o.guests, u.name,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount, 'tendered', p.tendered,
                   'reference', p.reference, 'createdAt', p.created_at) ORDER BY p.created_at)
               FROM payments p WHERE p.bill_id = b.id
           ), '[]'::JSONB)
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.opened_by
    WHERE b.restaurant_id = p_restaurant_id AND b.id = p_bill_id;
$$;

-- Records one payment. When the bill is covered it is marked paid, the order closes and the table is free again.
CREATE OR REPLACE FUNCTION dineniro_payment_add(
    p_restaurant_id VARCHAR, p_bill_id VARCHAR, p_payment_id VARCHAR, p_method VARCHAR, p_amount NUMERIC,
    p_tendered NUMERIC, p_reference VARCHAR, p_user_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_bill bills%ROWTYPE;
    v_paid NUMERIC;
BEGIN
    SELECT * INTO v_bill FROM bills WHERE restaurant_id = p_restaurant_id AND id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF v_bill.status = 'paid' THEN RAISE EXCEPTION 'Service Error: this bill is already paid.'; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE bill_id = p_bill_id;
    IF p_amount > v_bill.total - v_paid THEN
        RAISE EXCEPTION 'Service Error: only % is left to pay on this bill.', to_char(v_bill.total - v_paid, 'FM999999990.00');
    END IF;

    INSERT INTO payments (id, restaurant_id, bill_id, method, amount, tendered, reference, received_by)
    VALUES (p_payment_id, p_restaurant_id, p_bill_id, p_method, p_amount, p_tendered, COALESCE(p_reference, ''), p_user_id);

    IF v_paid + p_amount >= v_bill.total THEN
        UPDATE bills SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = p_bill_id;
        UPDATE orders SET status = 'paid', closed_at = CURRENT_TIMESTAMP WHERE id = v_bill.order_id;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_bills_recent(p_restaurant_id VARCHAR, p_limit INTEGER DEFAULT 30)
RETURNS TABLE(id VARCHAR, number INTEGER, table_label VARCHAR, total NUMERIC, paid NUMERIC, status VARCHAR, created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, methods TEXT)
LANGUAGE SQL STABLE
AS $$
    SELECT b.id, b.number, t.label, b.total,
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id = b.id), 0),
           b.status, b.created_at, b.paid_at,
           (SELECT string_agg(DISTINCT p.method, ', ') FROM payments p WHERE p.bill_id = b.id)
    FROM bills b JOIN orders o ON o.id = b.order_id JOIN dining_tables t ON t.id = o.table_id
    WHERE b.restaurant_id = p_restaurant_id
    ORDER BY (b.status = 'open') DESC, b.created_at DESC
    LIMIT GREATEST(LEAST(p_limit, 100), 1);
$$;

-- 6. RESERVATIONS AND THE WAITLIST

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A booking for a table and a time. Two bookings for one table can never overlap: the database refuses it.
CREATE TABLE IF NOT EXISTS reservations (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    table_id VARCHAR(64) NOT NULL,
    guest_name VARCHAR(120) NOT NULL,
    phone VARCHAR(50) NOT NULL DEFAULT '',
    party_size INTEGER NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'booked',
    note VARCHAR(300) NOT NULL DEFAULT '',
    order_id VARCHAR(64),
    created_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reservations_table FOREIGN KEY (restaurant_id, table_id)
        REFERENCES dining_tables (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_reservations_order FOREIGN KEY (restaurant_id, order_id)
        REFERENCES orders (restaurant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (order_id),
    CONSTRAINT chk_reservations_party CHECK (party_size BETWEEN 1 AND 60),
    CONSTRAINT chk_reservations_time CHECK (ends_at > starts_at AND ends_at <= starts_at + INTERVAL '8 hours'),
    CONSTRAINT chk_reservations_status CHECK (status IN ('booked', 'seated', 'completed', 'cancelled', 'no_show'))
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_reservations_no_overlap') THEN
        ALTER TABLE reservations ADD CONSTRAINT ex_reservations_no_overlap
            EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
            WHERE (status IN ('booked', 'seated'));
    END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_reservations_day ON reservations (restaurant_id, starts_at);

-- Walk-ins waiting for a table.
CREATE TABLE IF NOT EXISTS waitlist_entries (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guest_name VARCHAR(120) NOT NULL,
    phone VARCHAR(50) NOT NULL DEFAULT '',
    party_size INTEGER NOT NULL,
    quoted_minutes INTEGER NOT NULL DEFAULT 15,
    note VARCHAR(300) NOT NULL DEFAULT '',
    status VARCHAR(10) NOT NULL DEFAULT 'waiting',
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    order_id VARCHAR(64),
    CONSTRAINT fk_waitlist_order FOREIGN KEY (restaurant_id, order_id)
        REFERENCES orders (restaurant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (order_id),
    CONSTRAINT chk_waitlist_party CHECK (party_size BETWEEN 1 AND 60),
    CONSTRAINT chk_waitlist_quote CHECK (quoted_minutes BETWEEN 0 AND 240),
    CONSTRAINT chk_waitlist_status CHECK (status IN ('waiting', 'seated', 'left'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_waiting ON waitlist_entries (restaurant_id, added_at) WHERE status = 'waiting';

-- When a booked party's bill is paid (or their visit is cancelled), the booking is complete and its time frees up.
CREATE OR REPLACE FUNCTION complete_reservation_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IN ('paid', 'void') AND OLD.status NOT IN ('paid', 'void') THEN
        UPDATE reservations SET status = 'completed', ends_at = GREATEST(starts_at + INTERVAL '1 minute', LEAST(ends_at, CURRENT_TIMESTAMP))
        WHERE order_id = NEW.id AND status = 'seated';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_complete_reservation ON orders;
CREATE TRIGGER trigger_complete_reservation
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION complete_reservation_on_close();

CREATE OR REPLACE FUNCTION dineniro_reservations(p_restaurant_id VARCHAR, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE(
    id VARCHAR, table_id VARCHAR, table_label VARCHAR, guest_name VARCHAR, phone VARCHAR, party_size INTEGER,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, status VARCHAR, note VARCHAR, order_id VARCHAR, created_by_name VARCHAR
)
LANGUAGE SQL STABLE
AS $$
    SELECT r.id, r.table_id, t.label, r.guest_name, r.phone, r.party_size, r.starts_at, r.ends_at, r.status, r.note, r.order_id, u.name
    FROM reservations r
    JOIN dining_tables t ON t.id = r.table_id
    LEFT JOIN users u ON u.id = r.created_by
    WHERE r.restaurant_id = p_restaurant_id AND r.starts_at < p_to AND r.ends_at > p_from
    ORDER BY r.starts_at, t.label;
$$;

-- Creates or changes a booking. Only bookings that are still 'booked' can be changed.
CREATE OR REPLACE FUNCTION dineniro_reservation_save(
    p_restaurant_id VARCHAR, p_id VARCHAR, p_table_id VARCHAR, p_guest_name VARCHAR, p_phone VARCHAR, p_party_size INTEGER,
    p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ, p_note VARCHAR, p_user_id VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_seats INTEGER;
BEGIN
    SELECT seats INTO v_seats FROM dining_tables WHERE restaurant_id = p_restaurant_id AND id = p_table_id AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service Error: that table is not on the floor.'; END IF;
    IF p_party_size > v_seats + 2 THEN
        RAISE EXCEPTION 'Service Error: that table seats %, too few for % guests.', v_seats, p_party_size;
    END IF;

    IF EXISTS (SELECT 1 FROM reservations WHERE id = p_id) THEN
        UPDATE reservations SET table_id = p_table_id, guest_name = p_guest_name, phone = COALESCE(p_phone, ''), party_size = p_party_size,
            starts_at = p_starts_at, ends_at = p_ends_at, note = COALESCE(p_note, '')
        WHERE id = p_id AND restaurant_id = p_restaurant_id AND status = 'booked';
        IF NOT FOUND THEN
            IF EXISTS (SELECT 1 FROM reservations WHERE id = p_id AND restaurant_id = p_restaurant_id) THEN
                RAISE EXCEPTION 'Service Error: only upcoming bookings can be changed.';
            END IF;
            RETURN NULL;
        END IF;
    ELSE
        INSERT INTO reservations (id, restaurant_id, table_id, guest_name, phone, party_size, starts_at, ends_at, note, created_by)
        VALUES (p_id, p_restaurant_id, p_table_id, p_guest_name, COALESCE(p_phone, ''), p_party_size, p_starts_at, p_ends_at, COALESCE(p_note, ''), p_user_id);
    END IF;
    RETURN p_id;
END;
$$;

-- Cancels a booking or marks a no-show; either frees the table's time.
CREATE OR REPLACE FUNCTION dineniro_reservation_close(p_restaurant_id VARCHAR, p_id VARCHAR, p_status VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_status NOT IN ('cancelled', 'no_show') THEN RAISE EXCEPTION 'Service Error: a booking can only be cancelled or marked as a no-show.'; END IF;
    UPDATE reservations SET status = p_status WHERE restaurant_id = p_restaurant_id AND id = p_id AND status = 'booked';
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM reservations WHERE restaurant_id = p_restaurant_id AND id = p_id) THEN
            RAISE EXCEPTION 'Service Error: this booking is no longer upcoming.';
        END IF;
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$$;

-- The party has arrived: open a visit at their table and link it to the booking.
CREATE OR REPLACE FUNCTION dineniro_reservation_seat(p_restaurant_id VARCHAR, p_id VARCHAR, p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking reservations%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM reservations WHERE restaurant_id = p_restaurant_id AND id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'Service Error: this booking is no longer upcoming.'; END IF;
    PERFORM dineniro_order_open(p_restaurant_id, p_order_id, v_booking.table_id, v_booking.party_size, p_user_id);
    UPDATE reservations SET status = 'seated', order_id = p_order_id,
        starts_at = LEAST(starts_at, CURRENT_TIMESTAMP)
    WHERE id = p_id;
    RETURN p_order_id;
END;
$$;

-- Tables that fit the party and are free of bookings for the whole time asked for.
CREATE OR REPLACE FUNCTION dineniro_tables_available(p_restaurant_id VARCHAR, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_party INTEGER, p_ignore_id VARCHAR DEFAULT NULL)
RETURNS TABLE(table_id VARCHAR, label VARCHAR, seats INTEGER, section VARCHAR)
LANGUAGE SQL STABLE
AS $$
    SELECT t.id, t.label, t.seats, t.section
    FROM dining_tables t
    WHERE t.restaurant_id = p_restaurant_id AND t.active AND t.seats + 2 >= p_party
      AND NOT EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.table_id = t.id AND r.status IN ('booked', 'seated') AND r.id IS DISTINCT FROM p_ignore_id
            AND tstzrange(r.starts_at, r.ends_at) && tstzrange(p_from, p_to)
      )
    ORDER BY (t.seats < p_party), t.seats, t.section, t.sort_order, t.label;
$$;

-- Waitlist.
CREATE OR REPLACE FUNCTION dineniro_waitlist(p_restaurant_id VARCHAR)
RETURNS SETOF waitlist_entries
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM waitlist_entries WHERE restaurant_id = p_restaurant_id AND status = 'waiting' ORDER BY added_at;
$$;

CREATE OR REPLACE FUNCTION dineniro_waitlist_add(p_restaurant_id VARCHAR, p_id VARCHAR, p_name VARCHAR, p_phone VARCHAR, p_party INTEGER, p_quote INTEGER, p_note VARCHAR)
RETURNS SETOF waitlist_entries
LANGUAGE SQL
AS $$
    INSERT INTO waitlist_entries (id, restaurant_id, guest_name, phone, party_size, quoted_minutes, note)
    VALUES (p_id, p_restaurant_id, p_name, COALESCE(p_phone, ''), p_party, COALESCE(p_quote, 15), COALESCE(p_note, ''))
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION dineniro_waitlist_left(p_restaurant_id VARCHAR, p_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE waitlist_entries SET status = 'left', resolved_at = CURRENT_TIMESTAMP
    WHERE restaurant_id = p_restaurant_id AND id = p_id AND status = 'waiting';
    RETURN FOUND;
END;
$$;

-- Seats a waiting party at a free table. Refused if the table is booked within the next hour.
CREATE OR REPLACE FUNCTION dineniro_waitlist_seat(p_restaurant_id VARCHAR, p_id VARCHAR, p_table_id VARCHAR, p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_entry waitlist_entries%ROWTYPE;
    v_next TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_entry FROM waitlist_entries WHERE restaurant_id = p_restaurant_id AND id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_entry.status <> 'waiting' THEN RAISE EXCEPTION 'Service Error: this party is no longer waiting.'; END IF;
    SELECT MIN(starts_at) INTO v_next FROM reservations
    WHERE table_id = p_table_id AND status = 'booked' AND ends_at > CURRENT_TIMESTAMP AND starts_at < CURRENT_TIMESTAMP + INTERVAL '60 minutes';
    IF v_next IS NOT NULL THEN
        RAISE EXCEPTION 'Service Error: this table has a booking within the next hour. Choose another table.';
    END IF;
    PERFORM dineniro_order_open(p_restaurant_id, p_order_id, p_table_id, v_entry.party_size, p_user_id);
    UPDATE waitlist_entries SET status = 'seated', resolved_at = CURRENT_TIMESTAMP, order_id = p_order_id WHERE id = p_id;
    RETURN p_order_id;
END;
$$;

-- The floor: every active table with what is happening at it right now, and its next booking.
-- A free table booked within the next hour (or whose guests are running late) shows as 'reserved'.
DROP FUNCTION IF EXISTS dineniro_floor(VARCHAR);
CREATE FUNCTION dineniro_floor(p_restaurant_id VARCHAR)
RETURNS TABLE(
    table_id VARCHAR, label VARCHAR, seats INTEGER, section VARCHAR, shape VARCHAR,
    order_id VARCHAR, guests INTEGER, opened_at TIMESTAMPTZ, server_name VARCHAR,
    state VARCHAR, running_total NUMERIC, unsent_items BIGINT,
    next_booking_id VARCHAR, next_booking_at TIMESTAMPTZ, next_booking_name VARCHAR, next_booking_party INTEGER
)
LANGUAGE SQL STABLE
AS $$
    SELECT t.id, t.label, t.seats, t.section, t.shape,
           o.id, o.guests, o.opened_at, u.name,
           CASE
               WHEN o.id IS NULL AND nb.starts_at < CURRENT_TIMESTAMP + INTERVAL '60 minutes' THEN 'reserved'
               WHEN o.id IS NULL THEN 'free'
               WHEN o.status = 'billed' THEN 'bill'
               WHEN EXISTS (SELECT 1 FROM kitchen_tickets k WHERE k.order_id = o.id AND k.status = 'ready') THEN 'ready'
               WHEN EXISTS (SELECT 1 FROM kitchen_tickets k WHERE k.order_id = o.id AND k.status IN ('new', 'cooking')) THEN 'cooking'
               WHEN EXISTS (SELECT 1 FROM kitchen_tickets k WHERE k.order_id = o.id) THEN 'served'
               ELSE 'seated'
           END,
           COALESCE((SELECT SUM(i.unit_price * i.quantity) FROM order_items i WHERE i.order_id = o.id AND i.status <> 'void'), 0),
           (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.status = 'draft'),
           nb.id, nb.starts_at, nb.guest_name, nb.party_size
    FROM dining_tables t
    LEFT JOIN orders o ON o.restaurant_id = t.restaurant_id AND o.table_id = t.id AND o.status IN ('open', 'billed')
    LEFT JOIN users u ON u.id = o.opened_by
    LEFT JOIN LATERAL (
        SELECT r.id, r.starts_at, r.guest_name, r.party_size FROM reservations r
        WHERE r.table_id = t.id AND r.status = 'booked' AND r.ends_at > CURRENT_TIMESTAMP
          AND r.starts_at < CURRENT_TIMESTAMP + INTERVAL '12 hours'
        ORDER BY r.starts_at LIMIT 1
    ) nb ON TRUE
    WHERE t.restaurant_id = p_restaurant_id AND t.active
    ORDER BY t.section, t.sort_order, t.label;
$$;

-- 7. INVENTORY: INGREDIENTS, RECIPES AND THE STOCK LEDGER

-- Something the kitchen buys and uses. on_hand is kept up to date by the stock ledger below; it may go
-- negative when the kitchen uses more than was recorded, which shows the count needs checking.
CREATE TABLE IF NOT EXISTS ingredients (
    id VARCHAR(64) PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'Other',
    unit VARCHAR(4) NOT NULL,
    on_hand NUMERIC(12,3) NOT NULL DEFAULT 0,
    par_level NUMERIC(12,3) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(120) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_ingredients_restaurant_id UNIQUE (restaurant_id, id),
    CONSTRAINT chk_ingredients_unit CHECK (unit IN ('kg', 'g', 'l', 'ml', 'pc')),
    CONSTRAINT chk_ingredients_amounts CHECK (par_level >= 0 AND unit_cost >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_name ON ingredients (restaurant_id, LOWER(name));

-- How much of each ingredient one portion of a dish uses, in the ingredient's own unit.
CREATE TABLE IF NOT EXISTS recipe_lines (
    restaurant_id VARCHAR(64) NOT NULL,
    menu_item_id VARCHAR(64) NOT NULL,
    ingredient_id VARCHAR(64) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    PRIMARY KEY (menu_item_id, ingredient_id),
    CONSTRAINT fk_recipe_lines_item FOREIGN KEY (restaurant_id, menu_item_id)
        REFERENCES menu_items (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_recipe_lines_ingredient FOREIGN KEY (restaurant_id, ingredient_id)
        REFERENCES ingredients (restaurant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_recipe_lines_quantity CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_recipe_lines_ingredient ON recipe_lines (ingredient_id);

-- Every change to stock, ever: sales when a ticket is sent, deliveries, counts, waste and returns from voids.
CREATE TABLE IF NOT EXISTS stock_movements (
    id BIGSERIAL PRIMARY KEY,
    restaurant_id VARCHAR(64) NOT NULL,
    ingredient_id VARCHAR(64) NOT NULL,
    change NUMERIC(12,3) NOT NULL,
    reason VARCHAR(10) NOT NULL,
    unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    order_item_id VARCHAR(64) REFERENCES order_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
    note VARCHAR(200) NOT NULL DEFAULT '',
    recorded_by VARCHAR(64) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_stock_movements_ingredient FOREIGN KEY (restaurant_id, ingredient_id)
        REFERENCES ingredients (restaurant_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_stock_movements_reason CHECK (reason IN ('sale', 'void', 'delivery', 'count', 'waste'))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient ON stock_movements (ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_restaurant ON stock_movements (restaurant_id, created_at DESC);

-- The ledger is the truth; on_hand follows it.
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ingredients SET on_hand = on_hand + NEW.change WHERE id = NEW.ingredient_id;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_apply_stock_movement ON stock_movements;
CREATE TRIGGER trigger_apply_stock_movement
AFTER INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- Sending a dish to the kitchen uses its recipe. Voiding it before the kitchen starts puts the stock back;
-- once cooking has started the food is gone, so nothing is returned.
CREATE OR REPLACE FUNCTION move_stock_for_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
        INSERT INTO stock_movements (restaurant_id, ingredient_id, change, reason, unit_cost, order_item_id, recorded_by)
        SELECT NEW.restaurant_id, r.ingredient_id, -(r.quantity * NEW.quantity), 'sale', i.unit_cost, NEW.id, NEW.added_by
        FROM recipe_lines r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.menu_item_id = NEW.menu_item_id;
    ELSIF OLD.status = 'sent' AND NEW.status = 'void'
        AND EXISTS (SELECT 1 FROM kitchen_tickets k WHERE k.id = NEW.ticket_id AND k.status = 'new') THEN
        INSERT INTO stock_movements (restaurant_id, ingredient_id, change, reason, unit_cost, order_item_id, recorded_by, note)
        SELECT m.restaurant_id, m.ingredient_id, -m.change, 'void', m.unit_cost, NEW.id, NEW.voided_by, 'Voided before cooking'
        FROM stock_movements m WHERE m.order_item_id = NEW.id AND m.reason = 'sale';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_move_stock_for_order_item ON order_items;
CREATE TRIGGER trigger_move_stock_for_order_item
AFTER UPDATE OF status ON order_items
FOR EACH ROW EXECUTE FUNCTION move_stock_for_order_item();

-- The menu, with how many more portions of each dish the recorded stock allows (NULL when it has no recipe).
DROP FUNCTION IF EXISTS dineniro_menu(VARCHAR);
CREATE FUNCTION dineniro_menu(p_restaurant_id VARCHAR)
RETURNS TABLE(
    category_id VARCHAR, category_name VARCHAR, category_sort INTEGER,
    item_id VARCHAR, name VARCHAR, description VARCHAR, price NUMERIC, station VARCHAR, available BOOLEAN, item_sort INTEGER,
    options JSONB, portions_left INTEGER, food_cost NUMERIC
)
LANGUAGE SQL STABLE
AS $$
    SELECT c.id, c.name, c.sort_order,
           i.id, i.name, i.description, i.price, i.station, i.available, i.sort_order,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta) ORDER BY o.sort_order, o.name)
               FROM menu_item_options o WHERE o.menu_item_id = i.id
           ), '[]'::JSONB),
           (SELECT GREATEST(MIN(FLOOR(g.on_hand / r.quantity)), 0)::INTEGER
              FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.menu_item_id = i.id),
           (SELECT SUM(r.quantity * g.unit_cost) FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.menu_item_id = i.id)
    FROM menu_categories c
    LEFT JOIN menu_items i ON i.restaurant_id = c.restaurant_id AND i.category_id = c.id
    WHERE c.restaurant_id = p_restaurant_id
    ORDER BY c.sort_order, c.name, i.sort_order, i.name;
$$;

-- Ingredients with how fast they are being used (average over the last 7 days of sales and waste).
CREATE OR REPLACE FUNCTION dineniro_ingredients(p_restaurant_id VARCHAR)
RETURNS TABLE(
    id VARCHAR, name VARCHAR, category VARCHAR, unit VARCHAR, on_hand NUMERIC, par_level NUMERIC, unit_cost NUMERIC,
    supplier VARCHAR, active BOOLEAN, used_today NUMERIC, used_per_day NUMERIC, dishes BIGINT
)
LANGUAGE SQL STABLE
AS $$
    SELECT g.id, g.name, g.category, g.unit, g.on_hand, g.par_level, g.unit_cost, g.supplier, g.active,
           COALESCE((SELECT -SUM(m.change) FROM stock_movements m
                     WHERE m.ingredient_id = g.id AND m.reason IN ('sale', 'void', 'waste') AND m.created_at >= date_trunc('day', CURRENT_TIMESTAMP)), 0),
           COALESCE((SELECT -SUM(m.change) / 7 FROM stock_movements m
                     WHERE m.ingredient_id = g.id AND m.reason IN ('sale', 'void', 'waste') AND m.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'), 0),
           (SELECT COUNT(*) FROM recipe_lines r WHERE r.ingredient_id = g.id)
    FROM ingredients g
    WHERE g.restaurant_id = p_restaurant_id
    ORDER BY g.active DESC, g.category, g.name;
$$;

CREATE OR REPLACE FUNCTION dineniro_ingredient_save(
    p_restaurant_id VARCHAR, p_id VARCHAR, p_name VARCHAR, p_category VARCHAR, p_unit VARCHAR,
    p_par_level NUMERIC, p_unit_cost NUMERIC, p_supplier VARCHAR, p_active BOOLEAN
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM ingredients WHERE id = p_id) THEN
        IF EXISTS (SELECT 1 FROM ingredients WHERE id = p_id AND restaurant_id = p_restaurant_id AND unit <> p_unit)
           AND EXISTS (SELECT 1 FROM stock_movements WHERE ingredient_id = p_id) THEN
            RAISE EXCEPTION 'Service Error: the unit cannot change once stock has been recorded. Add a new ingredient instead.';
        END IF;
        UPDATE ingredients SET name = p_name, category = COALESCE(p_category, 'Other'), unit = p_unit, par_level = COALESCE(p_par_level, 0),
            unit_cost = COALESCE(p_unit_cost, 0), supplier = COALESCE(p_supplier, ''), active = COALESCE(p_active, TRUE)
        WHERE id = p_id AND restaurant_id = p_restaurant_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
    ELSE
        INSERT INTO ingredients (id, restaurant_id, name, category, unit, par_level, unit_cost, supplier, active)
        VALUES (p_id, p_restaurant_id, p_name, COALESCE(p_category, 'Other'), p_unit, COALESCE(p_par_level, 0), COALESCE(p_unit_cost, 0),
                COALESCE(p_supplier, ''), COALESCE(p_active, TRUE));
    END IF;
    RETURN p_id;
END;
$$;

-- Records a stock change of one kind. Deliveries also update the ingredient's cost when one is given.
-- Counts record the difference between what was counted and what the system expected.
CREATE OR REPLACE FUNCTION dineniro_stock_record(
    p_restaurant_id VARCHAR, p_ingredient_id VARCHAR, p_kind VARCHAR, p_quantity NUMERIC, p_unit_cost NUMERIC, p_note VARCHAR, p_user_id VARCHAR
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_on_hand NUMERIC;
    v_cost NUMERIC;
    v_change NUMERIC;
BEGIN
    SELECT on_hand, unit_cost INTO v_on_hand, v_cost FROM ingredients
    WHERE restaurant_id = p_restaurant_id AND id = p_ingredient_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF p_kind = 'delivery' THEN
        IF p_quantity <= 0 THEN RAISE EXCEPTION 'Service Error: a delivery must add something.'; END IF;
        v_change := p_quantity;
        IF p_unit_cost IS NOT NULL THEN
            v_cost := p_unit_cost;
            UPDATE ingredients SET unit_cost = p_unit_cost WHERE id = p_ingredient_id;
        END IF;
    ELSIF p_kind = 'waste' THEN
        IF p_quantity <= 0 THEN RAISE EXCEPTION 'Service Error: record how much was thrown away.'; END IF;
        v_change := -p_quantity;
    ELSIF p_kind = 'count' THEN
        IF p_quantity < 0 THEN RAISE EXCEPTION 'Service Error: a count cannot be below zero.'; END IF;
        v_change := p_quantity - v_on_hand;
    ELSE
        RAISE EXCEPTION 'Service Error: unknown kind of stock change.';
    END IF;

    IF v_change <> 0 THEN
        INSERT INTO stock_movements (restaurant_id, ingredient_id, change, reason, unit_cost, note, recorded_by)
        VALUES (p_restaurant_id, p_ingredient_id, v_change, p_kind, v_cost, COALESCE(p_note, ''), p_user_id);
    END IF;
    RETURN v_on_hand + v_change;
END;
$$;

CREATE OR REPLACE FUNCTION dineniro_stock_history(p_restaurant_id VARCHAR, p_ingredient_id VARCHAR, p_limit INTEGER DEFAULT 30)
RETURNS TABLE(id BIGINT, change NUMERIC, reason VARCHAR, note VARCHAR, dish VARCHAR, table_label VARCHAR, recorded_by_name VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE SQL STABLE
AS $$
    SELECT m.id, m.change, m.reason, m.note, oi.name, t.label, u.name, m.created_at
    FROM stock_movements m
    LEFT JOIN order_items oi ON oi.id = m.order_item_id
    LEFT JOIN orders o ON o.id = oi.order_id
    LEFT JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = m.recorded_by
    WHERE m.restaurant_id = p_restaurant_id AND m.ingredient_id = p_ingredient_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT GREATEST(LEAST(p_limit, 200), 1);
$$;

CREATE OR REPLACE FUNCTION dineniro_recipe(p_restaurant_id VARCHAR, p_menu_item_id VARCHAR)
RETURNS TABLE(ingredient_id VARCHAR, name VARCHAR, unit VARCHAR, quantity NUMERIC, unit_cost NUMERIC)
LANGUAGE SQL STABLE
AS $$
    SELECT g.id, g.name, g.unit, r.quantity, g.unit_cost
    FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id
    WHERE r.restaurant_id = p_restaurant_id AND r.menu_item_id = p_menu_item_id
    ORDER BY g.name;
$$;

-- Replaces a dish's recipe with p_lines: [{ "ingredientId", "quantity" }].
CREATE OR REPLACE FUNCTION dineniro_recipe_save(p_restaurant_id VARCHAR, p_menu_item_id VARCHAR, p_lines JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM menu_items WHERE restaurant_id = p_restaurant_id AND id = p_menu_item_id) THEN RETURN FALSE; END IF;
    DELETE FROM recipe_lines WHERE menu_item_id = p_menu_item_id;
    INSERT INTO recipe_lines (restaurant_id, menu_item_id, ingredient_id, quantity)
    SELECT p_restaurant_id, p_menu_item_id, l.value->>'ingredientId', (l.value->>'quantity')::NUMERIC
    FROM jsonb_array_elements(p_lines) l;
    RETURN TRUE;
END;
$$;
