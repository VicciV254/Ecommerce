# Apex Cart

Apex Cart is a React/Vite storefront and Express/Prisma administration
application under an incremental overhaul. Catalog prices and checkout
quotes are server-owned; pending-order reservations are explicitly opt-in.
Verified payment processing is not enabled yet.

---

## Overview

A customer-facing catalog and staff workspace with hierarchical departments,
sellable variants, per-SKU stock, scoped customer state, and versioned
storefront presentation settings.

## Getting Started

### Prerequisites

- Node.js **24.22.1** (pinned in `.nvmrc`) and npm **11.19.1**
- Docker with the Compose plugin for isolated local PostgreSQL checks

### Installation

```bash
git clone https://github.com/VicciV254/Ecommerce
cd Ecommerce
npm ci
npm --prefix backend ci
npm --prefix backend run build
```

### Running the Application

The root and `backend/` are separate npm packages. Use their checked-in
lockfiles; `npm run build` bundles the frontend, while the backend build
generates Prisma Client.

**Local configuration:**

```bash
cp .env.example .env.local
cp backend/.env.example backend/.env
```

Do not overwrite an existing environment file. Configure unique signing
secrets and the local database connection in `backend/.env`. See
[Backend setup](backend/SETUP.md) for database initialization and safety gates.
No Vercel or Neon connection is required to run the isolated checks below.

**Backend:**

```bash
npm --prefix backend run dev
```

With the example configuration, the backend runs on `http://127.0.0.1:5000`.
Importing the app/server does not start a listener or operational jobs.
Background jobs are **off by default**; deliberately set
`BACKGROUND_JOBS_ENABLED=true` only where legacy order progression,
refund-email notifications and image-host session refresh should run.

**Frontend:**

```bash
npm run dev
```

The app will open at `http://localhost:5173`.

### Building for Production

```bash
npm run build
```

The production build is output to the `dist/` folder.

## Verification

```bash
npm run check
npm --prefix backend run check
npm run test:e2e
```

The frontend check runs TypeScript, ESLint, component tests and the bundle.
The backend check generates Prisma Client, then runs ESLint and Node tests.
Browser checks start with a 390px mobile viewport, followed by desktop. They
build a production frontend with a loopback fixture API URL, then use an
automatically managed Vite preview server and fixture API/media responses,
not the live site. The port-scoped build is kept under `.cache/`; ordinary
development still uses `npm run dev`. This avoids development-module loading
overhead during browser checks without changing interaction assertions or
their timeouts. The fixtures also cover newly opened tabs.
Interaction checks include narrow-phone/tablet drawer resizing, keyboard
search, modifier-click navigation, nested dialogs, focus restoration and
feedback inside active dialogs. Native dialog behavior is checked in the
browser, not simulated by jsdom. If Chromium is missing, install the project's
browser revision with `npx --no-install playwright install chromium`.

On a shared workstation, select a free loopback port without reusing or
stopping another preview: `E2E_PORT=4274 npm run test:e2e`. The default is
4173; the test server, browser origin and API fixtures use the same setting.

To run the PostgreSQL/API integration checks:

```bash
docker compose -p apex-tests -f compose.test.yml up --detach --wait
TEST_DATABASE_URL=postgresql://apex_test:local_test_only@127.0.0.1:55432/apex_test \
  npm --prefix backend run test:integration
docker compose -p apex-tests -f compose.test.yml down
```

The test service binds only to loopback and uses temporary storage. Use a
unique Compose project name on a shared workstation; do not reuse or stop
another task's service. The runner requires a local `apex_test` database and
a role allowed to create/drop test databases. It creates a random
`apex_test_<id>` database for each integration test file, applies the real
migrations and deletes only that database in cleanup. Tests do not load
`backend/.env` or send real email,
payments or image uploads.

The existing migrations include explicit `public` references, so integration
checks use a new database rather than just a new schema. Never point this
runner at Neon or another shared/production database.

`npm run typecheck`, `npm run lint`, `npm run test:unit` and their backend
counterparts can also be run separately. Fix failing checks rather than
replacing type checking with the Vite build.

## Fresh catalog and demo data

The canonical catalog contains categories with parent/order/visibility
metadata, products, variants with unique SKUs, per-variant stock, and stable
media records. Public visibility includes ancestor visibility and
server-owned demo/live rules. There is no static product catalog or JSON
`adminData` catalog to fall back to.

The guarded local initializer provides **14 departments, 47 groups and 230
leaf categories**, with one labelled demo product per leaf and a focused
multi-variant example. Placeholder URLs are fixed selections with stored
source/license metadata. They are not claims of actual product photography,
commercial prices or inventory.

After configuring an **empty local** development database and private staff
credentials, run migrations and inspect the initializer first:

```bash
npm --prefix backend run migrate:deploy
npm --prefix backend run seed:demo -- --dry-run
ALLOW_DEMO_INITIALIZATION=true npm --prefix backend run seed:demo
```

Set `ALLOW_DEMO_CATALOG=true` in the local backend environment to include
demo products in the development storefront. It has no effect in production
and never enables purchases. Initialization creates only missing stable
records; repeat runs preserve edits, hidden/deleted fixtures, additional
products, users, orders and existing staff credentials. See
[Backend setup](backend/SETUP.md) for the exact guards and required keys.

## Development contracts

- Pass canonical products to `ProductCard`. Cards, detail and search use
  each variant's server-generated `pricing` projection and available stock;
  the browser does not recalculate discounts. Base prices remain separate
  for staff editing, and missing price projections are an explicit error.
- Customer credentials are attached per request, never as a sticky Axios
  default. Concurrent customer 401s share a bounded refresh and each request
  retries at most once. Staff headers and public sign-in failures do not use
  customer refresh credentials. Superseded-session responses are cancelled;
  transient transport errors do not automatically sign out the customer.
- Browser state uses an `apex-cart:v2` namespace; old tokens, `nmb-*` catalog,
  theme, cart and receipt data are not imported. Backend JWT issuer/audience
  checks also reject legacy tokens. Browser receipts and the former staff
  receipt-import endpoint are not order sources.
- Public settings come only from the published storefront snapshot. Draft
  saves and publication are separate, version-checked operations. Disabled
  sections and unused campaigns are omitted from public responses; invalid
  catalog/media references cannot be published.
- Staff drafts include their referenced media and explicit unavailable IDs,
  so unpublished artwork remains previewable after reload. Campaigns share
  copy and CTA across screens; without separate mobile artwork, phones use
  the desktop asset with the campaign's mobile focal point.
- Use the shared `Link` for hash routes. It forwards anchor attributes and
  refs, respects a caller's `preventDefault`, and leaves modified clicks,
  alternate targets and downloads to the browser.
- Use `ModalDialog` or `ConfirmModal` instead of independent fixed overlays.
  They provide native modality, initial/restored focus, boundary Tab wrapping,
  Escape and backdrop dismissal. Guard `onClose` during pending operations,
  keep content viewport-bounded, and put feedback in the active dialog.
  The shared `Toast` follows the active dialog layer.

## Checkout and pricing

The cart requests a quote using only variant IDs, quantities, an owned
address, delivery choice and optional coupon. The server calculates
**16% VAT added to discounted merchandise**, delivery and the total using
decimal arithmetic. The compatibility profile retains KES 200 standard/
pickup delivery, KES 500 same-day delivery and nearest-KES-10 automatic
offer rounding. Final delivery coverage and commercial policy still need
merchant review; the versioned server profile can change without adding
client-side pricing rules. See [Backend setup](backend/SETUP.md).

Quotes expire after 10 minutes by default. Price, address or delivery
changes require a new quote and visible customer review. Coupon and delivery
choices persist with the account-scoped cart. Percentage and fixed coupons
compete with existing offers rather than stacking on the same merchandise;
a fixed coupon is deducted once from its eligible basket.

`ENABLE_ORDER_RESERVATIONS=false` is the default. Set it explicitly in an
isolated development environment to exercise **Reserve Order**. Both
`POST /api/orders` and `/api/orders/checkout` now accept only `{quoteId}` and
an `Idempotency-Key` header. Client totals, payment status and ownership
claims are rejected, not used as input. Creation atomically stores immutable
price/address/item snapshots and holds the exact variants for 15 minutes.
On-hand and reserved units are separate; staff cannot reduce on-hand stock
below reserved stock.

An unknown response retains the same quote and request key across retries
and reloads. Only a verified server order removes the matching cart units;
new additions remain. Cancellation and expiry release the hold once.
Unpaid reservations do not count as sales or progress to fulfilment.
Existing orders retain their saved allocation semantics, and incomplete
allocations require review rather than a guessed replacement SKU.

Payments remain unavailable: reserving an order neither sends an M-Pesa
prompt nor marks it paid. Demo orders require a separate
`ALLOW_DEMO_ORDERS=true` opt-in in development/test, remain labelled demo,
and are excluded from live reporting; production rejects that mode.
Legacy amount-only M-Pesa handlers remain unavailable until verified,
order-linked payment processing is implemented.

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool & dev server
- **Tailwind CSS 4** - Utility-first styling
- **Express** - Backend API
- **PostgreSQL** - Database
- **Prisma** - ORM

## Project Structure

```
├── backend/          # Express API with PostgreSQL database
│   ├── prisma/      # Database schema and migrations
│   └── src/         # API routes and controllers
├── src/             # Frontend React application
│   ├── components/  # Reusable UI components
│   ├── pages/       # Page components
│   ├── store/       # State management
│   └── api/         # API client
├── public/          # Static assets
└── vercel.json      # Deployment configuration
```

## Admin Dashboard

Access the admin dashboard at `/#/admin` (staff-only). Features include:

- Dashboard overview with metrics
- Product catalog management
- Stock management
- Discount management
- Order management
- Customization options
