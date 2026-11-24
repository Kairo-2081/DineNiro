<div align="center">

<img src="./.github/assets/readme/dineniro-mark.png" alt="DineNiro" width="88" />

# DineNiro

**From the floor to the bill.**

Restaurant operations for Bangladesh: one workspace for the owner, the floor,
the kitchen and the till, with every restaurant approved before it goes live.

![TypeScript](https://img.shields.io/badge/TypeScript-React%2019%20%2B%20Express-0b0705?style=flat-square&logo=typescript&logoColor=d8b37c)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B%20·%20raw%20SQL-0b0705?style=flat-square&logo=postgresql&logoColor=d8b37c)
![Tests](https://img.shields.io/badge/tests-38%20against%20real%20Postgres-0b0705?style=flat-square&logo=nodedotjs&logoColor=d8b37c)
![Payments](https://img.shields.io/badge/payments-cash%20·%20card%20·%20bKash%20·%20Nagad-0b0705?style=flat-square)
![Hosting](https://img.shields.io/badge/hosted-Render%20+%20Neon%20·%20Singapore-0b0705?style=flat-square&logo=render&logoColor=d8b37c)

[Live app](https://dineniro-xhdy.onrender.com) ·
[Watch a dinner service](./.github/assets/readme/service-tour.webm) ·
[Database design](./docs/database-design.md) ·
[Deploy guide](#deploy)

<picture>
<source media="(prefers-color-scheme: dark)" srcset="./.github/assets/readme/banner.jpg" />
<img src="./.github/assets/readme/banner-light.jpg" alt="The DineNiro seal beside the floor plan and a paid bill with its printed receipt" width="900" />
</picture>

</div>

<div align="center">

[Product tour](#product-tour) · [How a table moves](#how-a-table-moves) ·
[The bill](#the-bill-and-the-money) · [Data model](#data-model) ·
[Performance](#performance) · [Quality](#quality-and-safety) ·
[Engineering](#engineering) · [Brand](#the-brand) ·
[Get started](#get-started) · [Status](#project-status-and-next-steps)

</div>

DineNiro runs a restaurant's whole service in one place. A host seats a party,
a waiter sends the order to the kitchen display, the chef cooks it through, the
cashier splits the bill across bKash and cash, and the owner sees the night in
reports that match the till. Each restaurant gets its own workspace and team, and
the rules that matter most (no double-booked tables, no data shared between
restaurants, stock that always adds up) are enforced by the database, not only
by the screens.

## At a glance

| | |
| --- | --- |
| **Six staff roles, one service** | Owners, managers, waiters, hosts, cashiers and chefs each see only the screens they use, on the same live data. |
| **Where it runs** | In the browser on any tablet, phone or till PC, and installable to the home screen as a full-screen app. Receipts are laid out for 80 mm thermal printers. |
| **Local payments** | Cash with change, card, bKash and Nagad, split as many ways as the table wants. VAT and service charge at each restaurant's own rates. |
| **Trust built in** | A platform admin approves every restaurant before it can trade; every approval, rejection and suspension is audited with a reason. |
| **Data** | 19 PostgreSQL tables, 37 foreign keys, 30 check constraints and an exclusion constraint. The API's queries go through 67 `dineniro_*` database functions. |
| **Verified** | 9 API route modules and 38 tests that run the real server against a real PostgreSQL database, including a whole dinner service. |

## Who does what

| Role | Gets | Opens into | Added by |
| --- | --- | --- | --- |
| **Owner** | Every screen: floor, bookings, kitchen, bills, stock, reports, setup and team | Floor | Applies for the restaurant; a platform admin approves it |
| **Manager** | Everything an owner has, except managing owners and other managers | Floor | An owner |
| **Waiter** | Floor, orders, bookings, the kitchen's ready food and printing the bill | Floor | An owner or manager |
| **Host** | Floor seating, bookings and the waitlist | Floor | An owner or manager |
| **Cashier** | Bills and payments, with a view of the floor and bookings | Bills | An owner or manager |
| **Chef** | The kitchen display, and stock deliveries, counts and waste | Kitchen | An owner or manager |
| **Platform admin** | Restaurant approvals, the audit trail and other admins | Approvals | Created on first start, or by another admin |

<details>
<summary><b>The full permission table</b></summary>
<br />

| | Owner | Manager | Waiter | Host | Cashier | Chef |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Seat a table | ✓ | ✓ | ✓ | ✓ | | |
| Bookings and waitlist | ✓ | ✓ | ✓ | ✓ | view | |
| Order and send to the kitchen | ✓ | ✓ | ✓ | | | |
| Void a sent dish, give a discount | ✓ | ✓ | | | | |
| Kitchen display: start and finish tickets | ✓ | ✓ | | | | ✓ |
| Mark ready food as served | ✓ | ✓ | ✓ | | | ✓ |
| Print the bill | ✓ | ✓ | ✓ | | ✓ | |
| Take payment | ✓ | ✓ | | | ✓ | |
| Deliveries, counts, waste | ✓ | ✓ | | | | ✓ |
| Ingredients and recipes | ✓ | ✓ | | | | view |
| Reports | ✓ | ✓ | | | | |
| Tables, menu, billing rates, team | ✓ | ✓ | | | | |

</details>

## Try it

| Who | What you can try |
| --- | --- |
| Restaurant owner | Open the [live app](https://dineniro-xhdy.onrender.com) and choose **Apply for your restaurant**. You can sign in straight away and follow the review; a platform admin approves it before the service screens unlock. |
| Staff | Staff accounts are created by their restaurant's owner or manager on the Team screen. There is no self-signup. |
| Platform admin | Not shared. The first admin is created from the deployment's own secret. |

No shared demo accounts are published. The live app runs on Render's free plan,
which sleeps after 15 idle minutes, so the first visit can take about a minute to wake.

## Product tour

Every image below is a real capture of the interface running on sample data: a
throwaway local database where scripted walkthroughs apply for a restaurant
called *Spice Route*, have it approved, build its menu and team, and run a
service, plus a few days of invented bills so the reports have a shape. Names,
dishes and amounts are made up; nothing comes from a real restaurant.

[**Watch a 31-second dinner service**](./.github/assets/readme/service-tour.webm)
(WebM, 1280 × 720): the owner signs in, seats Table 2, orders, sends to the
kitchen, cooks it through, serves it, prints the bill, takes cash, and the
evening's report updates.

<div align="center">

<a href="./.github/assets/readme/service-tour.webm"><img src="./.github/assets/readme/service-tour-poster.jpg" alt="A frame from the dinner service recording" width="900" /></a>

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-sign-in.jpg" alt="Sign-in page with the DineNiro seal, the headline and the staff sign-in form" width="100%" />
<p><b>Sign in or apply.</b> Staff sign in with a username or email; restaurants apply from the same page.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-floor.jpg" alt="Floor plan with tables coloured by status and a seated table's details on the right" width="100%" />
<p><b>Read the room.</b> Every table coloured by what is happening at it: free, reserved, seated, cooking, food ready, served or bill printed.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-kitchen-moving.jpg" alt="Kitchen display with tickets in New, Cooking and Ready to serve columns" width="100%" />
<p><b>Cook to the ticket.</b> The kitchen display moves each ticket from New to Cooking to Ready, with timers.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-reports-today.jpg" alt="Reports with net sales, covers, average check, sales by hour, payment mix, top dishes and staff" width="100%" />
<p><b>Close the night.</b> Sales, covers and the money breakdown, from paid bills, so they match the till.</p>
</td>
</tr>
</table>

</div>

### Inside each workspace

#### Waiter

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-order.jpg" alt="Order screen for Table T1 with the menu by category and an unsent ticket of nine dishes" width="100%" />
<p><b>Take the order.</b> Dishes by category or search, with priced options and a note for the kitchen. Nothing reaches the kitchen until <i>Send</i>.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-order-stock.jpg" alt="Order screen for Table T1 whose ticket lists dishes already sent to the kitchen and waiting in its queue" width="100%" />
<p><b>Follow what's been sent.</b> Dishes already with the kitchen stay on the ticket with their place in its queue. When stock runs low, a dish shows how many portions are left.</p>
</td>
</tr>
</table>

#### Chef

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-kitchen-new.jpg" alt="Kitchen display with new tickets waiting to start" width="100%" />
<p><b>New tickets arrive.</b> Each with its table, its waiter, the options and the note, filtered by station.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-stock.jpg" alt="Stock screen with ingredients against par, low-stock warnings and the delivery, count and waste form" width="100%" />
<p><b>Keep stock true.</b> Record deliveries, counts and waste. Every change lands in a ledger that names the dish and table behind each sale.</p>
</td>
</tr>
</table>

#### Cashier

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-bill-split.jpg" alt="Bill for Table T1 split between bKash with a transaction ID and cash" width="100%" />
<p><b>Split the bill.</b> Any mix of cash, card, bKash and Nagad. Mobile payments need their transaction ID.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-bill-paid.jpg" alt="Paid bill with the receipt and a note that the table is free again" width="100%" />
<p><b>Paid in full frees the table.</b> The receipt carries the restaurant's BIN, and change for cash is worked out.</p>
</td>
</tr>
</table>

<p align="center">
<img src="./.github/assets/readme/app-receipt-print.jpg" alt="The printed receipt alone, as it comes out of an 80 mm printer, ending with the DineNiro mark" width="240" />
</p>
<p align="center"><b>The printed slip.</b> Laid out for 80 mm thermal paper, ending with the restaurant's footer and a small DineNiro mark.</p>

#### Host

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-bookings.jpg" alt="Reservations timeline of tables with the waitlist beside it" width="100%" />
<p><b>Book the evening.</b> A day timeline of every table. Tap a gap to book it; the database refuses overlaps.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-waitlist-seat.jpg" alt="Seating a waiting walk-in party, with only tables that fit the party offered" width="100%" />
<p><b>Seat the walk-ins.</b> Only tables big enough for the party are offered, and never one booked within the hour.</p>
</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-booking-new.jpg" alt="New booking dialog suggesting free tables that fit the party for the whole slot" width="100%" />
<p><b>Book in a few taps.</b> DineNiro suggests the tables that fit the party and stay free for the whole booking.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-floor-reserved.jpg" alt="Floor plan with a table marked Reserved for a booking within the hour" width="100%" />
<p><b>Reserved shows on the floor.</b> A table booked within the hour is marked, so nobody seats a walk-in there.</p>
</td>
</tr>
</table>

#### Owner and manager

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-recipe.jpg" alt="Recipe editor with ingredient quantities and the food cost per plate" width="100%" />
<p><b>Cost every plate.</b> A recipe per dish sets what each sale takes off stock and what the plate costs to make.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-reports-week.jpg" alt="Weekly report with sales by day, payment mix, top dishes and staff totals" width="100%" />
<p><b>Compare the week.</b> Today, yesterday, 7 or 30 days, each against the period before, with export to CSV.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-setup.jpg" alt="Setup screen with billing rates, tables and the menu with categories, dishes and options" width="100%" />
<p><b>Set up the restaurant.</b> Billing rates, the receipt footer, tables, and the menu with priced options and sold-out switches.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-team.jpg" alt="Team screen listing the owner and a waiter, with the form to add staff" width="100%" />
<p><b>Build the team.</b> Add staff with a role and a starting password to hand over in person.</p>
</td>
</tr>
</table>

#### Platform admin

<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-admin-approvals.jpg" alt="Approvals queue with a pending restaurant, its licence and VAT details, and approve and reject buttons" width="100%" />
<p><b>Approve restaurants.</b> Each application shows its owner, trade licence and VAT BIN before it is approved or rejected with a reason.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-owner-pending.jpg" alt="An owner's view of their restaurant while it waits for review" width="100%" />
<p><b>Owners see where they stand.</b> A pending, rejected or suspended restaurant shows its status and reason, and nothing else.</p>
</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-apply.jpg" alt="Restaurant application form with restaurant details, trade licence, VAT BIN and the owner's account" width="100%" />
<p><b>Apply in one form.</b> Restaurant details, trade licence, VAT BIN and the owner's account, from the sign-in page.</p>
</td>
<td width="50%" valign="top">
<img src="./.github/assets/readme/app-admin-audit.jpg" alt="Approvals with the status-change audit trail listing who approved which restaurant and when" width="100%" />
<p><b>Every decision on record.</b> The audit trail shows who changed each restaurant's status, when, and why.</p>
</td>
</tr>
</table>

#### On a phone

<table>
<tr>
<td width="33%" align="center" valign="top">
<img src="./.github/assets/readme/app-phone-landing.jpg" alt="Sign-in page on a 390-pixel-wide phone" width="230" />
<p><b>Sign in anywhere.</b> 390 × 844.</p>
</td>
<td width="33%" align="center" valign="top">
<img src="./.github/assets/readme/app-phone-floor.jpg" alt="Floor plan on a phone with tables in one column" width="230" />
<p><b>The floor in a pocket.</b> Tables stack into one column.</p>
</td>
<td width="33%" align="center" valign="top">
<img src="./.github/assets/readme/app-phone-order.jpg" alt="Ordering for Table T5 on a phone, menu first" width="230" />
<p><b>Order at the table.</b> The menu comes first, with the ticket below it.</p>
</td>
</tr>
</table>

DineNiro has one theme, dark, made for dim dining rooms and kitchen screens that run all night.

## How a table moves

One table touches every role. The integration tests in
[`tests/service.test.ts`](./tests/service.test.ts) cover this path end to end.

```mermaid
sequenceDiagram
    autonumber
    actor Host
    actor Waiter
    actor Chef
    actor Cashier
    participant DB as DineNiro API + PostgreSQL

    Host->>DB: Seat 4 guests at T1
    DB-->>Host: Order opened (one open order per table)
    Waiter->>DB: Add dishes, options and a note
    Waiter->>DB: Send to the kitchen
    DB-->>Chef: New ticket, recipe taken off stock
    Chef->>DB: Start, then mark ready
    DB-->>Waiter: Floor shows "Food ready"
    Waiter->>DB: Mark served, print the bill
    DB-->>Cashier: Bill with discount, service charge and VAT
    Cashier->>DB: bKash with transaction ID, then cash with change
    DB-->>Host: Paid in full, table free, booking completed
```

### Statuses

Every status below is a value the database accepts (a `CHECK` constraint), so a
typo can't invent a new one. The database functions decide which moves are allowed.

| Thing | Statuses, in the usual order | Notes |
| --- | --- | --- |
| Restaurant | `pending` → `approved` · `rejected` · `suspended` | Only approved restaurants reach the service screens |
| Order (a table's visit) | `open` → `billed` → `paid` · `void` | Only one `open` or `billed` order per table, by a partial unique index |
| Dish on an order | `draft` → `sent` · `void` | A sent dish can only be voided by a manager, with a reason |
| Kitchen ticket | `new` → `cooking` → `ready` → `served` | Moves one step at a time; two cooks can't move it twice |
| Bill | `open` → `paid` | Frozen once the first payment is taken |
| Payment method | `cash` · `card` · `bkash` · `nagad` | bKash and Nagad need a transaction ID |
| Booking | `booked` → `seated` → `completed` · `cancelled` · `no_show` | Completed automatically when the table's bill is paid |
| Waitlist party | `waiting` → `seated` · `left` | |
| Stock movement | `sale` · `void` · `delivery` · `count` · `waste` | An append-only ledger; on-hand stock is kept by a trigger |
| Staff role | `owner` · `manager` · `waiter` · `host` · `cashier` · `chef` | The last owner can't be removed or demoted |

## The bill and the money

| Step | How it works |
| --- | --- |
| **Subtotal** | Every sent dish at the price it had when ordered. Unsent dishes block the bill until they are sent or removed. |
| **Discount** | Managers and owners only, between zero and the food total. |
| **Service charge** | The restaurant's rate on the subtotal after discount, rounded to the paisa. |
| **VAT** | The restaurant's rate on the subtotal after discount plus the service charge, rounded to the paisa. |
| **Payments** | Any mix of cash, card, bKash and Nagad. Cash records what was handed over and works out the change; no payment can exceed what is left to pay. |

```mermaid
flowchart TD
    A([Waiter prints the bill]) --> B[Subtotal of sent dishes]
    B --> C[minus discount<br/>managers only]
    C --> D[plus service charge<br/>restaurant's rate]
    D --> E[plus VAT<br/>on food and service]
    E --> F{Cashier takes payment}
    F -->|Cash| G[Tendered and change recorded]
    F -->|Card| H[Recorded]
    F -->|bKash / Nagad| I[Transaction ID required]
    G --> J{Paid in full?}
    H --> J
    I --> J
    J -->|Not yet| F
    J -->|Yes| K[Order paid, table free,<br/>booking completed]
    K --> L[Counted in reports<br/>by paid time]
```

| Rule | Why it matters |
| --- | --- |
| **The bill is computed in the database**, from the order's sent dishes and the restaurant's own rates | The browser can't change a price, a rate or a total |
| **A bill freezes at its first payment** | Nobody can edit an order underneath a half-paid bill |
| **Reports read paid bills only**, by the time they were paid | The night's figures match what is in the till |
| **Stock moves only through a ledger** | Every gram can be traced to a delivery, a count, waste or a dish sold at a table |

## Data model

19 tables and 37 foreign keys in four domains. Rows that belong to a restaurant
carry its ID in a **composite key** with their own, so an order can't point at
another restaurant's table or dish, even through a bug in the API.

```mermaid
erDiagram
    users ||--o{ staff_memberships : "works as"
    restaurants ||--o{ staff_memberships : employs
    restaurants ||--o{ restaurant_status_audit : "reviewed in"
    restaurants ||--o{ dining_tables : has
    restaurants ||--o{ menu_categories : has
    menu_categories ||--o{ menu_items : groups
    menu_items ||--o{ menu_item_options : offers
    dining_tables ||--o{ orders : seats
    orders ||--o{ order_items : contains
    menu_items ||--o{ order_items : "ordered as"
    orders ||--o{ kitchen_tickets : "sent as"
    kitchen_tickets ||--o{ order_items : carries
    orders ||--o| bills : "billed by"
    bills ||--o{ payments : "settled by"
    dining_tables ||--o{ reservations : "booked as"
    orders |o--o{ reservations : fulfils
    restaurants ||--o{ waitlist_entries : keeps
    restaurants ||--o{ ingredients : stocks
    menu_items ||--o{ recipe_lines : "made from"
    ingredients ||--o{ recipe_lines : "used in"
    ingredients ||--o{ stock_movements : "moved by"
    order_items |o--o{ stock_movements : "sold as"
```

| Domain | Tables | What it holds |
| --- | --- | --- |
| Platform and people | `users`, `restaurants`, `staff_memberships`, `restaurant_status_audit`, `auth_sessions` | Who can sign in, where they work, and every approval decision |
| Service | `dining_tables`, `menu_categories`, `menu_items`, `menu_item_options`, `orders`, `order_items`, `kitchen_tickets`, `bills`, `payments` | A table's visit from seating to the last payment |
| Front of house | `reservations`, `waitlist_entries` | Bookings and walk-ins |
| Inventory | `ingredients`, `recipe_lines`, `stock_movements` | What is in the store room and why it changed |

Design choices worth knowing:

- **No double bookings, even at the same instant.** An exclusion constraint on (table, time range) refuses overlapping bookings for the same table, so two hosts booking at once can't both succeed.
- **One open visit per table.** A partial unique index allows only one `open` or `billed` order per table.
- **Stock follows the food.** Triggers take a dish's recipe off stock when it is sent, put it back if it is voided before cooking, and keep on-hand stock in step with the ledger.
- **Rules live in one place.** The API calls `dineniro_*` functions in [`schema.sql`](./schema.sql) rather than composing SQL in route handlers.
- **The schema applies itself.** `schema.sql` is idempotent and runs on every start, so a fresh database becomes a working one with no separate migration step.

The reasoning behind each table is in [`docs/database-design.md`](./docs/database-design.md).

## Performance

The target: on a mid-range phone on mobile 4G, a waiter who opens DineNiro sees
the floor **in under 3 seconds**, and a sent order reaches the kitchen screen
before the waiter is back at the pass.

| Measure | Median | Slowest | Runs |
| --- | --- | --- | --- |
| Sign-in page visible, cold cache | 2.72 s | 2.74 s | 9 |
| Signed-in waiter sees the floor, cold cache | 3.14 s | 3.22 s | 9 |
| A sent order appears on the kitchen screen | 3.08 s | 5.33 s (fastest 0.81 s) | 12 |
| API: floor · kitchen · menu (p50 / p95) | 3.4 / 5.3 · 3.6 / 5.6 · 2.8 / 3.4 ms | | 200 each |
| API: a 7-day report (p50 / p95) | 12.3 / 17.7 ms | | 200 |
| First-load JavaScript and CSS | 104 kB gzipped, 370 kB as sent today | | |

**Where it stands against the target:** the sign-in page fits; the signed-in
floor misses by about 0.15 s. The likely main reason is in the last row: the
Express server sends the app **uncompressed**. Compressing it is the first fix
under [next steps](#project-status-and-next-steps). The kitchen delay is by
design: the kitchen screen checks for new tickets every 5 seconds, so a ticket
arrives within 0 to 5 seconds of *Send*.

**Read the numbers with care.** They were measured on 25 Nov 2026 on one
machine against a local server and database, using Chromium to emulate a
mid-range phone (150 ms round trip, 1.6 Mbps down, a processor four times
slower) from a cold cache. It is a controlled lab measure, not real staff; the
live site adds the distance to Singapore and the free plan's wake-up, and
whether Render compresses responses at its edge has not been checked.
**No real phone or tablet has been tested yet.**

## Quality and safety

| Area | What is in place |
| --- | --- |
| **Tests** | 38 Node test-runner cases in 6 files. The integration tests start the real server against a real PostgreSQL database and cover applications, approvals, role limits, isolation, session revocation, a whole dinner service, bookings, stock and reports |
| **Restaurant isolation** | Every restaurant route checks the signed-in person's membership and answers *not found* to anyone else; composite keys stop cross-restaurant rows in the database itself |
| **API access** | Deny-by-default: only listed method and path pairs are public; everything else needs a session |
| **Sessions** | A 12-hour JWT in an HttpOnly cookie, with its ID stored in the database so signing out revokes it at once |
| **Passwords** | bcrypt; staff starting passwords of at least 8 characters, the first admin's at least 12 |
| **Concurrency** | An exclusion constraint for bookings, a partial unique index for seating, and a step check so two cooks can't move the same ticket twice |
| **Money** | Totals computed in the database from the restaurant's own rates; bills freeze at the first payment; no payment beyond what is owed, apart from cash change |
| **Refusing bad config** | The server won't start without a 32-character `JWT_SECRET`; the first admin is created only from a 12-character secret |

### Launch evidence (measured 25 Nov 2026)

Everything below was measured in a disposable local sandbox: one Node process,
a throwaway PostgreSQL 16 database and sample data. None of it is a production
figure, and no load was sent to the live site.

| Check | Result |
| --- | --- |
| **12 hosts book the same table at once** | 30 rounds of 12 simultaneous requests for the same table and time: exactly one booking each round, 30 of 360 attempts, no overlaps |
| **12 waiters seat the same table at once** | 30 rounds of 12 simultaneous requests: exactly one open order each round, 30 of 360 attempts |
| **Test suite** | 38 of 38 pass against a fresh database |
| **Type check** | `tsc --noEmit` passes |
| **Dinner service recording** | Seat, order, send, cook, serve, bill, pay and report, recorded end to end in one take with no page errors |

What this does not prove, and what is still open before a restaurant relies on it:

| Item | Status |
| --- | --- |
| A real service in a real restaurant | **Not done.** Everything so far is sample data |
| Real tablets, phones and thermal printers | **Not tested.** Printing goes through the browser's print dialog |
| Continuous integration | **None yet.** Tests are run before each merge, by hand |
| Automatic deploys | **Not working yet.** Render needs access to this repository; see [Deploy](#deploy) |
| Accessibility audit | **Not done.** Real buttons and labels throughout, but no axe, Lighthouse or screen-reader pass yet |
| External security review | **Not done** |
| Response compression | **Missing** in the app; whether Render adds it is unchecked |
| Backups | **Neon's own** restore history only; no restore has been rehearsed |

## Engineering

### Technology

| Layer | Technology |
| --- | --- |
| Web app | React 19, Vite, TypeScript, Tailwind CSS 4 |
| API | Node.js, Express, TypeScript |
| Database | PostgreSQL 15 or later, with `btree_gist`; raw SQL through `pg` |
| Authentication | App-issued JWT in an HttpOnly cookie; database-backed revocation; bcrypt |
| Testing | Node.js test runner with `tsx`, against a real PostgreSQL database |
| Hosting | Render (Singapore) for the app, Neon (Singapore) for PostgreSQL |
| Installable | Web app manifest and home-screen icons |

### Decisions and trade-offs

- **Rules in the database.** Status moves, billing, stock and isolation live in
  PostgreSQL functions, triggers and constraints, so two waiters racing for one
  table can't both win whatever the screens do. The cost is that changing a rule
  means changing SQL, and the logic is less visible to someone reading only the
  TypeScript.
- **Polling, not sockets.** Screens refresh on a timer: the kitchen every 5 seconds,
  the floor and bills every 10. It survives flaky restaurant Wi-Fi and needs
  nothing beyond plain HTTP, at the cost of up to 5 seconds of delay and steady
  background requests.
- **One schema file, applied on start.** `schema.sql` is idempotent and runs on
  every boot, so a new database needs no migration tool. That suits a young
  product; once real restaurants hold data, numbered migrations will be safer.
- **Revocable sessions.** Session IDs are stored, so signing out or removing a
  staff member takes effect at once, at the cost of one database lookup per request.
- **One dark theme.** Built for dim dining rooms and kitchen screens that stay on
  all night. A light theme for daytime cafés isn't planned yet.
- **Print through the browser.** Receipts are styled for 80 mm paper and printed
  with the browser's dialog. Silent printing needs a small helper on the till PC.

### Architecture

```mermaid
flowchart LR
    S[Owner / Manager / Waiter<br/>Host / Cashier / Chef] --> W[React app<br/>tablet, phone, till PC]
    PA[Platform admin] --> W
    W -->|HTTPS, HttpOnly session cookie,<br/>polling every 5 to 60 s| A[Express API<br/>Render, Singapore]
    A -->|dineniro_* functions| D[(PostgreSQL<br/>Neon, Singapore)]
    W -->|browser print| P[80 mm receipt printer]
```

### Delivery pipeline

```mermaid
flowchart LR
    B[Feature branch] --> T[Type check and<br/>38 tests, locally]
    T --> PR[Pull request]
    PR --> M[Merge to main]
    M --> R[Render build<br/>npm ci and npm run build]
    R --> S[Start: apply schema.sql,<br/>create first admin if missing]
    S --> H{GET /api/health<br/>database reachable?}
    H -->|yes| L[(Live)]
    H -->|no| K[Deploy fails]
```

The health check answers only when the app can reach its database, and Render
uses it to decide whether a deploy succeeded.

## The brand

<p align="center">
  <img src="./.github/assets/readme/seal.gif" alt="The DineNiro seal: a brass fork and spoon swing shut, then the name and tagline appear" width="320" />
</p>

| Logo | Where it goes |
|---|---|
| **Seal**: crossed silverware, the name and *From the floor to the bill* in a double ring | 64 px and up: sign-in, loading screens, print and social |
| **Mark**: the silverware alone on an ink disc | Under 64 px: browser tab, sidebar, top bar, home-screen icon |
| **Receipt mark**: the disc in black only | The foot of every printed slip |

The name is set in **Cormorant Garamond**, with *Niro* in brass italic, and the
tagline in **Inter**. The colours are Ink `#0B0705`, Brass `#D8B37C` and Cream
`#F4E9DA`. On sign-in, the seal's fork and spoon swing shut once; people who
reduce motion see it still. In code: `BrandSeal`, `BrandMark` and `BrandLockup`
in [`src/components/brand.tsx`](./src/components/brand.tsx), and the icons in `public/`.

## Get started

### Requirements

- Node.js 20 or later (22 recommended)
- PostgreSQL 15 or later with the standard `btree_gist` extension (Neon and Supabase both include it)

### Install

```sh
git clone https://github.com/Kairo-2081/DineNiro.git
cd DineNiro
npm ci
cp .env.example .env
```

Set `DATABASE_URL` to an empty database (add `DATABASE_SSL=false` for a local
one without TLS), a `JWT_SECRET` of at least 32 random characters, and a
`DINENIRO_ADMIN_PASSWORD` of at least 12. Generate a secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Then start it:

```sh
npm run dev
```

The app opens at `http://localhost:3000`, and the schema applies itself on start.
Sign in as `admin` with your admin password, apply for a restaurant from a
private window, approve it, then open **Setup** and **Team** as the owner.

### Environment variables

| Variable | When needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Always | PostgreSQL connection string. `SUPABASE_DB_*` variables work instead. |
| `DATABASE_SSL` | Local databases | Set to `false` for a database without TLS. |
| `JWT_SECRET` | Always | Signs session tokens; at least 32 characters, or the server won't start. |
| `DINENIRO_ADMIN_PASSWORD` | First start | Creates the first platform admin (at least 12 characters). Remove it once you have signed in. |
| `DINENIRO_ADMIN_EMAIL` | Optional | The first admin's email. Defaults to `admin@dineniro.local`. |
| `PORT` | Optional | Defaults to 3000; Render sets it. |

### Deploy

[`render.yaml`](./render.yaml) describes the whole service, in Singapore.

1. Create an empty Neon project and copy its **direct** connection string: the host without `-pooler`.
2. In Render choose **New → Blueprint**, pick this repository, and paste the Neon string as `DATABASE_URL`.
3. Render generates `JWT_SECRET` and `DINENIRO_ADMIN_PASSWORD`. On first start the app builds the schema and the admin account; the password is under the service's **Environment** tab.
4. Give Render's GitHub app access to this repository: GitHub → **Settings → Applications → Render → Configure**. Without it the first deploy still works, but merges to `main` never trigger another one.

If a deploy doesn't start, use **Manual Deploy → Deploy latest commit**. The free
plan sleeps after 15 idle minutes and takes about a minute to wake; use Starter
for a restaurant in real service.

### Tests

The tests start the real server against `TEST_DATABASE_URL` and **wipe that
database first**, so point them at one you don't need.

```sh
npm run lint
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dineniro_test npm test
```

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and the web app with Vite |
| `npm run build` / `npm start` | Builds the app and server, then serves the production build |
| `npm run lint` | Type-checks the whole project (`tsc --noEmit`) |
| `npm test` | Runs the test suite, one file at a time, against `TEST_DATABASE_URL` |

### Documentation map

| If you want to… | Read |
| --- | --- |
| Understand the data | [`docs/database-design.md`](./docs/database-design.md) and [`schema.sql`](./schema.sql) |
| Call or extend the API | The [API reference](#api-reference) below, and `server/routes/` |
| Deploy | [Deploy](#deploy) and [`render.yaml`](./render.yaml) |
| Change the logo | [The brand](#the-brand) and [`src/components/brand.tsx`](./src/components/brand.tsx) |

### API reference

<details>
<summary><b>Every route</b></summary>
<br />

| Method | Path | Who |
|---|---|---|
| `POST` | `/api/auth/login` | anyone |
| `GET` | `/api/auth/me` | anyone (guests get `authenticated: false`) |
| `POST` | `/api/auth/logout` | signed in |
| `GET` | `/api/health` | anyone |
| `POST` | `/api/restaurants` | anyone: apply with a new owner account |
| `GET` | `/api/restaurants/:restaurantId` | members of that restaurant |
| `GET` `POST` | `/api/restaurants/:restaurantId/staff` | owners and managers |
| `PATCH` `DELETE` | `/api/restaurants/:restaurantId/staff/:userId` | owners and managers |
| `GET` | `/api/admin/stats` | platform admins |
| `GET` | `/api/admin/restaurants?status=` | platform admins |
| `PUT` | `/api/admin/restaurants/:id/status` | platform admins |
| `GET` | `/api/admin/restaurants/audit` | platform admins |
| `POST` | `/api/admin/admins` | platform admins |

Service routes, under `/api/restaurants/:restaurantId` for approved restaurants:

| Method | Path | What it does |
|---|---|---|
| `PATCH` | `/settings` | service charge %, VAT %, receipt footer |
| `GET` `POST` / `PUT` | `/tables`, `/tables/:tableId` | tables |
| `GET` | `/menu` | categories with dishes and options |
| `POST` `PUT` `DELETE` | `/categories`, `/categories/:id` | menu categories |
| `POST` `PUT` | `/menu-items`, `/menu-items/:id` | dishes and their options |
| `GET` | `/floor` | every table with its current state |
| `POST` | `/orders` | seat a table |
| `GET` | `/orders/:orderId` | an order with its lines |
| `POST` `PATCH` | `/orders/:orderId/items`, `/items/:itemId` | add a dish; change or remove an unsent one |
| `POST` | `/orders/:orderId/items/:itemId/void` | void a sent dish with a reason |
| `POST` | `/orders/:orderId/send` | send unsent dishes to the kitchen |
| `POST` | `/orders/:orderId/void` | cancel a visit where nothing was sent |
| `GET` | `/kitchen` | open tickets |
| `POST` | `/kitchen/:ticketId/advance` | move a ticket one step |
| `POST` | `/orders/:orderId/bill` | print (or reprint with a discount) the bill |
| `GET` | `/bills`, `/bills/:billId` | recent bills; one bill with its receipt |
| `POST` | `/bills/:billId/payments` | take a payment |
| `GET` `POST` / `PUT` | `/reservations?from=&to=`, `/reservations/:id` | bookings in a range; book or change |
| `POST` | `/reservations/:id/close`, `/reservations/:id/seat` | cancel or no-show; seat the party |
| `GET` | `/availability?startsAt=&minutes=&party=` | free tables that fit the party |
| `GET` `POST` | `/waitlist` | waiting walk-ins; add one |
| `POST` | `/waitlist/:id/seat`, `/waitlist/:id/left` | seat at a table; they left |
| `GET` `POST` / `PUT` | `/ingredients`, `/ingredients/:id` | stock list; add or change an ingredient |
| `POST` | `/ingredients/:id/stock` | record a delivery, count or waste |
| `GET` | `/ingredients/:id/history` | one ingredient's ledger |
| `GET` `PUT` | `/recipes/:menuItemId` | a dish's recipe |
| `GET` | `/reports?from=&to=&tz=` | sales report with the previous period |

</details>

### Project layout

```text
src/
  components/         React UI: Landing, ApplyForm, brand.tsx (the logo),
                      restaurant/ (floor, order, kitchen, bills, bookings, stock,
                      reports, setup, team) and admin/ (approvals)
  contexts/           the signed-in session
  lib/                API client and formatting helpers
  db/                 connection, password hashing, schema start-up and first admin
server/
  routes/             9 *.routes.ts modules, mounted in app.ts
  middleware/         sessions, the public-route allowlist, role and membership checks
schema.sql            every table, trigger, constraint and dineniro_* function
tests/                Node test-runner integration tests against PostgreSQL
docs/                 database design
public/               favicon, home-screen icons and the web manifest
render.yaml           the Render service
```

## Project status and next steps

- **Faster first load:** compress responses in the app (gzip or Brotli). It is the
  likely main reason the signed-in floor misses the 3-second target.
- **Continuous integration:** run the type check and the 38 tests on every pull
  request, against a disposable PostgreSQL.
- **Automatic deploys:** give Render's GitHub app access to the repository.
- **Real-world checks:** a service on real tablets and a real thermal printer, an
  accessibility pass, and a restore drill from a Neon backup.
- **Silent printing:** a small helper on the till PC for kitchen tickets and
  receipts without the browser's print dialog.
- **Schema migrations:** move from one self-applying schema file to numbered
  migrations before real restaurants hold data.
- **Staff invitations by email**, instead of handing over a starting password.

## License

No licence has been chosen yet, so all rights are reserved by the author.

<br />

<p align="center">
  <sub>DineNiro · built for restaurants in Bangladesh · ৳</sub>
</p>
