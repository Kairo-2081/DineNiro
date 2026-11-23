# DineNiro database design

DineNiro runs on PostgreSQL. `schema.sql` is applied on every server start, so every statement in it is idempotent. The API never writes SQL inline against tables: every read and write goes through a `dineniro_*` function in the schema.

## Entity-relationship diagram

```mermaid
erDiagram
    USERS {
        varchar id PK
        varchar username UK "lower-case, unique ignoring case"
        varchar email UK "unique ignoring case"
        varchar password "bcrypt hash"
        varchar name
        varchar phone
        varchar role "admin | staff"
        timestamptz created_at
    }
    RESTAURANTS {
        varchar id PK
        varchar name
        varchar phone
        varchar address
        varchar area
        varchar city
        varchar cuisine
        varchar trade_licence_no
        varchar vat_bin
        varchar status "pending | approved | rejected | suspended"
        text status_reason
        varchar created_by FK
        timestamptz created_at
        timestamptz status_changed_at
    }
    STAFF_MEMBERSHIPS {
        varchar restaurant_id PK, FK
        varchar user_id PK, FK
        varchar role "owner | manager | waiter | chef | cashier | host"
        boolean active
        timestamptz created_at
    }
    RESTAURANT_STATUS_AUDIT {
        bigserial id PK
        varchar restaurant_id FK
        varchar old_status
        varchar new_status
        text reason
        varchar changed_by FK
        timestamptz changed_at
    }
    AUTH_SESSIONS {
        varchar jti PK
        varchar user_id FK
        timestamptz expires_at
        timestamptz revoked_at
        timestamptz created_at
    }

    USERS ||--o{ STAFF_MEMBERSHIPS : "works as"
    RESTAURANTS ||--|{ STAFF_MEMBERSHIPS : "employs"
    RESTAURANTS ||--o{ RESTAURANT_STATUS_AUDIT : "history"
    USERS |o--o{ RESTAURANT_STATUS_AUDIT : "changed by"
    USERS |o--o{ RESTAURANTS : "applied"
    USERS ||--o{ AUTH_SESSIONS : "signs in"
```

## Accounts

There are two kinds of account. A **platform admin** (`users.role = 'admin'`) approves and suspends restaurants and never works inside one. A **staff** account (`role = 'staff'`) belongs to restaurants through `staff_memberships`, with one role per restaurant. The same person can be a manager at one restaurant and a waiter at another.

The first admin is created at start-up from `DINENIRO_ADMIN_PASSWORD`. Later admins are added by an existing admin. No demo data is seeded.

## Restaurant approval

A new owner applies through `dineniro_restaurant_apply`, which creates their account, the restaurant (status `pending`) and their `owner` membership in one transaction.

`dineniro_restaurant_status_update` allows only these moves:

| From | To |
|---|---|
| pending | approved, rejected |
| approved | suspended |
| suspended | approved |
| rejected | pending |

Rejecting or suspending needs a reason, which owners and staff see. The `trigger_restaurant_status_change` trigger writes every change, including the first `pending` row, to `restaurant_status_audit`. The acting user comes from the transaction setting `dineniro.actor_id`, which the status functions set.

Staff management requires an approved restaurant. That rule is enforced in the API (`requireMembership({ requireApproved: true })`).

## Staff rules held by the database

- `trigger_membership_user_role`: only staff accounts can join a restaurant.
- `trigger_protect_last_owner`: removing, demoting or pausing the last active owner is refused. The restaurant's owner rows are locked first, so two concurrent requests cannot both remove the last two owners.
- `dineniro_staff_add` links an existing staff account found by email instead of creating a duplicate. That account keeps its own password.

Owners can manage every role. Managers can add and change cashiers, hosts, waiters and chefs only. The API enforces this in `server/routes/staff.routes.ts`.

## Isolation between restaurants

Every restaurant-scoped route has `:restaurantId` in its path and goes through `requireMembership`. That middleware loads the caller's own active membership for that restaurant. If there is none, it answers 404, the same answer as for a restaurant that does not exist, so one restaurant cannot find out another's IDs. Service tables carry `restaurant_id` and are read only through this check (see Service below).

## Sessions

Each sign-in issues a 12-hour JWT whose `jti` is stored in `auth_sessions`. Every API request checks that the `jti` is still active, so signing out revokes the session immediately. Expired rows are cleaned up when the next session is created.

## Service

```mermaid
erDiagram
    RESTAURANTS ||--o{ DINING_TABLES : has
    RESTAURANTS ||--o{ MENU_CATEGORIES : has
    MENU_CATEGORIES ||--o{ MENU_ITEMS : contains
    MENU_ITEMS ||--o{ MENU_ITEM_OPTIONS : offers
    DINING_TABLES ||--o{ ORDERS : "seats (one open at a time)"
    ORDERS ||--o{ ORDER_ITEMS : contains
    ORDERS ||--o{ KITCHEN_TICKETS : "sent as"
    KITCHEN_TICKETS ||--o{ ORDER_ITEMS : groups
    MENU_ITEMS ||--o{ ORDER_ITEMS : "copied into"
    ORDERS ||--o| BILLS : "billed by"
    BILLS ||--o{ PAYMENTS : "paid by"
```

Restaurants also carry `service_charge_pct`, `vat_pct` (each 0 to 30) and `receipt_footer`.

**Keeping restaurants apart in the database.** Each service table has `restaurant_id`, and every parent has a `UNIQUE (restaurant_id, id)` key. Children reference that pair, for example `orders (restaurant_id, table_id) → dining_tables (restaurant_id, id)`. So an order cannot point at another restaurant's table, and an order line cannot point at another restaurant's dish, even if the API had a bug. Every `dineniro_*` service function also takes the restaurant ID first and filters by it.

**A visit.** `orders.status` moves `open → billed → paid`, or `open → void` when guests leave before anything was sent. A partial unique index (`uq_orders_active_table`) allows only one open or billed order per table.

**Order lines.** `order_items` copies the dish name and its price including chosen options, so editing the menu never changes a past order. Lines start as `draft`. Tapping the same dish with the same options and note adds to the draft line. Sending turns every draft line into `sent` and groups them into one kitchen ticket. A sent line can't be deleted: a manager voids it with a reason, and voided lines are not billed or printed.

**Kitchen tickets** move `new → cooking → ready → served`. `dineniro_ticket_advance` must be told the status the ticket is moving from, so a second tap from another screen cannot skip a step. Ticket numbers count up per restaurant, serialised by locking the restaurant row.

**Bills.** `dineniro_bill_prepare` refuses while dishes are unsent, then fixes the amounts:

```
food      = sum of sent lines
discount  ≤ food                      (managers and owners only)
service   = round((food − discount) × service %, 2)
VAT       = round((food − discount + service) × VAT %, 2)
total     = food − discount + service + VAT
```

Adding food after the bill is printed drops the bill and reopens the order, unless a payment has already been taken. Then the change is refused.

**Payments.** Cash, card, bKash or Nagad. `dineniro_payment_add` locks the bill and refuses anything above what is left. When payments cover the total, the bill and order close and the table shows as free. Cash stores the amount received (`tendered`) for the change line. bKash and Nagad require the transaction ID, enforced by the API.
