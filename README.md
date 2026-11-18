# Apex Cart

Apex Cart is a React/Vite storefront and Express/Prisma administration
application under an incremental overhaul. Catalog prices and checkout
quotes are server-owned; order reservations and the order-linked M-Pesa
integration are separately opt-in. Real provider verification and production
activation remain required before accepting customer payments.

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
`BACKGROUND_JOBS_ENABLED=true` only on an always-on host that should check
pending payments, expire holds and retry customer emails. Serverless deployments use the protected daily maintenance endpoint
instead (see [Backend setup](backend/SETUP.md)). Orders never advance on a
timer: staff confirm each fulfilment step.

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
- The draft preview shows the storefront at phone, tablet and desktop widths
  (390, 768 and 1280 px) by running the shoppers' renderer in a same-origin
  frame (`#/admin/storefront/preview-frame`) whose viewport is that width,
  scaled down only for display. Any framing policy for the frontend must
  allow its own origin (`frame-ancestors 'self'`). Links don't open from the
  preview, and its product cards offer no buying or wishlist.
- Every publication is kept in a publication history with its time and
  publisher. Super admins and admins can restore an earlier version into the
  draft (never straight to shoppers); a version that breaks the current rules
  or uses a deleted product, category or image is refused. Section headings
  cannot claim a ranking or popularity the store does not measure, such as
  "best sellers" or "trending".
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
decimal arithmetic. Automatic offers round to the nearest KES 10.

Delivery methods come from the server's checkout policy. The catalog
(`GET /api/catalog`) publishes the offered ones as `delivery` (fee,
free-delivery threshold and covered counties), and the cart and checkout list
exactly those, in that order. By default: Standard delivery anywhere in Kenya,
KES 200; Same-day delivery in Nairobi County only, KES 500; **Store pickup is
off** for new orders, while orders already placed with it still show and
complete. There is no free-delivery threshold, and VAT never applies to the
delivery fee. County names match however they are written ("Nairobi City
County", "nairobi"). A saved Store pickup choice falls back to the first
offered method. The promises under each choice ("2–5 working days") are worded
in `src/store/storeFacts.ts`. The versioned server profile can change without
adding client-side pricing rules. See [Backend setup](backend/SETUP.md).

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

Reserving an order neither sends an M-Pesa prompt nor marks it paid.
The separate payment action submits only its saved order ID and phone number;
it cannot choose the charge amount. Accepted STK prompts remain pending, and
unknown outcomes cannot trigger a second automatic charge. Only correlated
receipt evidence plus an authenticated provider status query finalizes
payment and inventory. Late payments stay in staff review without reopening
cancelled orders. See [M-Pesa setup and boundaries](backend/SETUP.md#order-linked-m-pesa).

Payments remain **off by default**. Sandbox uses explicitly allowed test
numbers and demo orders only; live mode requires separate production
enablement and provider onboarding. Fractional-KES totals are rejected for
M-Pesa, never silently rounded. Local test doubles do not prove a real
Safaricom sandbox transaction or production readiness. No M-Pesa PIN is
collected by the application.

Sandbox STK tests may involve real funds. [Safaricom's FAQ](https://developer.safaricom.co.ke/faqs)
describes reversal of STK test funds; the application does not guarantee
refund timing. Obtain explicit recipient and amount approval before a test
prompt rather than assuming sandbox means no debit.

## Demonstration store

`DEMONSTRATION_STORE=true` in the backend environment runs the public
demonstration store: the storefront shows and sells only sample products, and
signed-in visitors can order them. A sample order is paid with a labelled
demonstration payment, which takes no money, sends no phone prompt and makes
no Safaricom request. M-Pesa stays in the sandbox, behind a closed "Pay with
M-Pesa sandbox instead" disclosure, and prompts go only to the approved test
numbers; production M-Pesa is refused. Each account can create up to
`DEMO_ORDER_DAILY_LIMIT` sample orders (default 10) in 24 hours.

The owner of a sample order then plays the store's part from **Demonstration
controls** in the order's receipt details: preparing, dispatching and
delivering it, approving and receiving a return, and recording the refund.
The buttons are exactly the steps the server lists in `demonstrationActions`,
and each sends the status it was shown with, so a stale step is refused and
the order reloads. Refunds of a demonstration payment have the method
`DEMONSTRATION`: they move no money, never carry an M-Pesa reference, send no
email, and staff can only cancel them.

Public wording about ordering and payment (FAQ, Terms, Privacy notice, footer,
About and checkout) follows the catalog snapshot's `demonstrationOrders`; until
it loads, or with it off, the pages keep the wording for a store whose checkout
stops before an order is placed. Order pages follow each order's
`paymentMethod`. See [Demonstration store](backend/SETUP.md#demonstration-store)
for the routes and guards.

## Public information pages

Apex Cart is a demonstration store, and its public pages say how it is set up
rather than promising delivery, refunds or emails. The Privacy notice and the
Terms of use are reviewed by the store's owner before they are published.

- Delivery (`#/delivery`), Returns and refunds (`#/returns`), the FAQ
  (`#/faq`), the Privacy notice (`#/privacy`) and the Terms of use
  (`#/terms`) share one reading layout, `src/components/InfoPage.tsx`. Long
  pages list their sections under "On this page" and link each one as
  `#/<page>?section=<id>`: the hash is the route, so there are no bare `#id`
  links. Following a section link scrolls its heading to just below the sticky
  header and moves focus to it; Back returns to the top of the page.
- FAQ questions are native disclosures (`<details>`): each answer stays closed
  until its question is opened by tap, click, Enter or Space, and several can
  be open at once. The topics remain the page's headings.
- Contacts, support hours, the demonstration statement, the policies' date and
  the delivery promises are worded once, in `src/store/storeFacts.ts`. A unit
  test fails if any other source file repeats the email address, phone number
  or hours.
- Fees, free-delivery thresholds, covered counties, the return window, the
  delivery-fee refund rule and the return rules by category come from the
  catalog snapshot (`GET /api/catalog`: `delivery`, `returnPolicy` and each
  category's `returnRule`), so the pages always match what checkout offers.
  Until the snapshot loads, Delivery and Returns show a loading panel and the
  FAQ gives general answers.
- An address the shop doesn't know shows a not-found page with links to the
  home page, the shop and Contact. It is served like every other page (there is
  no HTTP 404 status).

## Search and link previews

Link previews (WhatsApp, X, Facebook) don't run JavaScript, so `index.html`
carries the store's description, canonical address and Open Graph and X card
tags beside `<title>`, ahead of the inlined app.

- The description is the demonstration statement from
  `src/store/storeFacts.ts`; a unit test keeps the two equal.
- The canonical address, `og:url` and `og:image` use the production address,
  `https://ecommerce-vicciv.vercel.app/`. Change all three if it changes.
- The preview image is `public/og-image.png` (1200×630): the gold mark, the
  store name and "A demonstration store" on navy.
- `public/robots.txt` lets every crawler in, including `/api`, which the pages
  render from.
- There is no product or offer markup and no sitemap: the products are samples,
  and hash routes (`#/…`) aren't separate pages to search engines.
- The tags are fixed text, so a store name changed in the storefront settings
  doesn't reach link previews.

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
- Product catalog management. A compare-at ("was") price must be higher than
  the product's price, or left empty: the editor and the API refuse anything
  else, including a price raised to or above a saved compare-at price. Products
  saved before the rule still load; their lower compare-at price is not shown.
- Stock management
- Discount management
- Promotions: newsletter subscribers and promotional emails. Each email carries
  a link that unsubscribes only its recipient (`#/unsubscribe?token=…`, which
  acts only when the person presses the button). Subscribing answers the same
  way whether or not an address was already subscribed, addresses are stored in
  lowercase, and an account's promotional-email preference always shows
  whether those emails are sent to its address.
- Order management
- Customization options
- Staff activity: sign-ins and staff changes, newest first, for super admins
  and admins
