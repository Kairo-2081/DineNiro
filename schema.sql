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
    INSERT INTO users (id, username, email, password, name, phone, role)
    VALUES (p_id, LOWER(p_username), LOWER(p_email), p_password, p_name, p_phone, 'admin');
    RETURN QUERY SELECT * FROM dineniro_user_get(p_id);
END;
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

