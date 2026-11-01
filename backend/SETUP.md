# Backend setup

Use Node.js 24.22.1 and npm 11.19.1, matching the repository runtime pin.
The API uses Express and Prisma with PostgreSQL 15. The frontend and backend
have separate npm manifests and lockfiles.

## Configuration

Copy `backend/.env.example` to `backend/.env` only if no local file exists.
The real `.env` is ignored by Git and excluded from container builds.

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Application database connection |
| `DIRECT_URL` | Direct connection for Prisma migrations; required by the schema |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Distinct, unique signing secrets of at least 32 characters |
| `HOST`, `PORT` | Local example binds `127.0.0.1:5000` |
| `CORS_ORIGIN` | Comma-separated frontend origins, matching their actual host/port |
| `BACKGROUND_JOBS_ENABLED` | Explicit opt-in to operational background services; defaults to `false` |
| `ALLOW_DEMO_CATALOG` | Show labelled demo catalog records outside production; defaults to `false` |
| `ALLOW_DEMO_INITIALIZATION` | Explicit per-invocation consent for the local demo initializer |
| `ENABLE_ORDER_RESERVATIONS` | Permit pending-order inventory holds; defaults to `false`, never enables payment |
| `ALLOW_DEMO_ORDERS` | Additional development/test-only opt-in for demo orders, separate from catalog visibility |
| `CHECKOUT_POLICY_JSON` | Optional complete validated pricing profile; empty uses `src/config/checkoutPolicy.js` defaults |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Private initial staff credentials for local initialization |

Keep signing secrets in the local environment or an approved secret store,
not in source, terminal transcripts or chat. Server startup rejects missing
required values and placeholder/short signing secrets before connecting.

Access and refresh tokens use HS256 and distinct keys; there is no fallback
signing secret. They identify issuer `apex-cart-api` and audience
`apex-cart:v2`; legacy tokens must not authenticate the fresh store.
Protected customer requests and refreshes re-read the current
account, reject disabled/deleted customers, and enforce email verification
when `ENABLE_EMAIL_VERIFICATION=true`. Optional authentication treats those
customers as guests rather than granting an authenticated identity.

Customer tokens identify only `userId`; staff tokens identify only `adminId`.
Malformed or mixed actor claims are rejected before a database query. Staff
roles come from the current database record, not token role claims. Account
projections used by order responses exclude password and verification/reset
credentials. Configuration and datastore failures reach error middleware
instead of being disguised as invalid tokens or anonymous sessions.

`POST /api/orders` and `POST /api/orders/checkout` share one strict
quote-based pending-order service. Neither accepts client totals, ownership
or payment-status claims. Creation requires explicit reservation enablement;
M-Pesa and refund processing for these orders remain unavailable until the
verified provider lifecycle is implemented. A reservation is not payment
or permission to fulfil an order.

External image-host, email and payment settings may remain empty/disabled
for local checks. Do not pull or replace live Vercel/Neon credentials just
to run the tests.

## Local application database

From the repository root, after configuring the signing secrets:

```bash
npm ci
npm --prefix backend ci
npm --prefix backend run build
docker compose --env-file backend/.env up --detach --wait postgres
npm --prefix backend run migrate:deploy
npm --prefix backend run dev
```

`migrate:deploy` uses the database in `backend/.env`; verify it is the
intended local database before running it. The example uses
`apex_development` on loopback port 5432. Existing migrations are checked
in; do not create another `init` migration to start the app.

The canonical-catalog migration is intentionally for the approved **fresh
database** strategy: it requires variant IDs for stock/cart records and does
not reconstruct legacy product data. Do not apply it to the current hosted
legacy database or guess stock allocations to make old rows fit.

The subsequent checkout migration converts monetary fields to
`Decimal(14,2)` and adds quotes/reservations. It is one atomic PostgreSQL
statement: existing negative, out-of-range or more-than-two-decimal amounts
stop it before any schema/data change. Do not silently round or delete such
records to force it through. Review the reported amounts and failed migration
ledger in the intended environment before proceeding. Existing stock keeps
its on-hand value, existing orders retain committed-allocation semantics,
and their current address is snapshotted; earlier address edits cannot be
reconstructed.

Run `npm run dev` separately for the frontend on port 5173. The development
Compose stack also maps frontend 5173 and backend 5000 on loopback:

```bash
docker compose --env-file backend/.env up --build
```

The development database volume is retained when the stack is stopped.
Do not remove volumes to troubleshoot a build. On shared machines, use
task-specific Compose project names and stop only services you own.

## Startup and background work

`src/app.js` constructs the API. `src/server.js` exports the app and
`startServer()`, but starts listening automatically only when executed as the
entrypoint. `startServer()` returns a `close()` function that closes the
listener, stops scheduled jobs and disconnects Prisma. SIGINT/SIGTERM use
the same cleanup.

Set `BACKGROUND_JOBS_ENABLED=true` only in an intentional operational
environment. It enables reservation expiry every 60 seconds, the existing
auto-stage job every 10 seconds, refund notification every 60 seconds and
optional image-host session work.
These services can mutate orders and send messages; they are not health
checks. A job does not overlap its previous invocation. `NODE_ENV=test`
always prevents background startup, even if the opt-in flag is set.
Catalog, quote, stock and order reads also process an expiry batch, so
restarting a server does not lose held inventory. The batch is bounded to
100 expired orders; repeated requests or job ticks drain a backlog.
Quoted orders cannot auto-progress until payment is verified and inventory
is committed. Final scheduler/runtime selection remains a release check.

Image uploads authenticate lazily when requested. Optional startup/session
refresh runs only with background jobs enabled and configured image-host
credentials. `IMAGE_HOST_SESSION_REFRESH=0` disables periodic refresh; a
configured host may still authenticate when background services start or
an upload requires a session.

## Checks without external services

```bash
npm --prefix backend run check
```

Unit tests inject test-only environment values before importing the app.
Application environment loading is disabled in test mode.
`src/scripts/testEmail.js` is a live-mail diagnostic, not a unit test;
do not invoke it without an approved recipient and provider configuration.

For database/API integration checks, use the separate ephemeral test service:

```bash
docker compose -p apex-tests -f compose.test.yml up --detach --wait
TEST_DATABASE_URL=postgresql://apex_test:local_test_only@127.0.0.1:55432/apex_test \
  npm --prefix backend run test:integration
docker compose -p apex-tests -f compose.test.yml down
```

The harness rejects remote hosts and non-test database names. Its role must
have `CREATEDB` permission, as the provided local service does. Every test
file gets a fresh, randomly named database; files cannot contaminate each
other. The configured base database is preserved. Whole-database isolation
is intentional: some migrations explicitly reference `public`.
For a focused run, append a known filename, for example
`npm --prefix backend run test:integration -- catalog.test.js`.

## Guarded local initialization

The destructive legacy seed and unauthenticated HTTP staff bootstrap are
retired. `seed` and `seed:demo` now run the same idempotent local initializer.
It creates only missing stable taxonomy/demo/variant/media records and never
updates an existing record as a side effect of rerunning.

Initialization requires:

- `NODE_ENV` is `development` or `test`.
- `DATABASE_URL` and `DIRECT_URL` identify the same loopback database/schema.
- The name is `apex_development`, `apex_test`, or an underscore-suffixed local variant.
- `ADMIN_EMAIL` and `ADMIN_USERNAME` are supplied privately. Creating the
  initial account also requires `ADMIN_PASSWORD` of at least 12 characters.
- A write invocation explicitly sets `ALLOW_DEMO_INITIALIZATION=true`.

```bash
npm --prefix backend run seed:demo -- --dry-run
ALLOW_DEMO_INITIALIZATION=true npm --prefix backend run seed:demo
```

The dry run performs no writes and does not require a password. A real run
does not reset an existing staff password or add a second administrator
under a changed initialization email. Output contains counts, never
credentials. Conflicting identifiers abort rather than overwrite records.
The seed includes 291 taxonomy nodes, 230 demo products, 231 SKUs and
independently replaceable, licensed placeholder-media records.

Set `ALLOW_DEMO_CATALOG=true` only for development previews. Production
always excludes demo records. Demo is a server-owned property, not a
client-controlled purchase flag. Replacing a sample photo does not silently
convert its product into commercial inventory.

Destructive resets are separate, still requiring
`ALLOW_LOCAL_DATABASE_RESET=true` and the local-target guard. They are not
needed to rerun initialization:

```bash
ALLOW_LOCAL_DATABASE_RESET=true npm --prefix backend run reset
```

The old hosted database being disposable does not authorize these commands
to contact it. Hosted-resource deletion and production connection changes
remain separate operations.

## Canonical API surfaces

| Route | Contract |
|---|---|
| `GET /api/catalog` | Complete visible catalog snapshot; mode and demo visibility are server-controlled |
| `GET /api/products` | Bounded pagination and descendant category filtering |
| `GET /api/admin/catalog` | Staff catalog including inactive/demo records |
| Product/category/designer CRUD | Validated JSON; stable IDs/slugs, soft retirement and transactional consistency |
| `/api/admin/stock/:variantId` | Per-SKU inventory, not product-level inferred allocation |
| `GET /api/settings/storefront` | Safe published configuration and referenced media only |
| `/api/settings/storefront/draft` | Staff draft with optimistic version checks, referenced media and unavailable media IDs |
| `POST /api/settings/storefront/publish` | Validate references, then atomically publish the current version |
| `POST /api/media` | Staff URL/provenance registration; external uploads remain separate |
| `POST /api/orders/quotes` | Authenticated, versioned, expiring server quote from IDs and customer choices |
| `GET /api/orders/quotes/:id` | Owner-only saved quote, including consumed/expired state for retry recovery |
| `POST /api/orders`, `POST /api/orders/checkout` | `{quoteId}` plus `Idempotency-Key`; create or replay an unpaid order atomically |
| `POST /api/orders/:id/cancel` | Owner cancellation; release reserved units once, with transactionally saved history |

The old `/settings/admin-data`, `/settings/theme`, `/admin/init` and
`/admin/orders/import-local` surfaces return HTTP 410. Catalog changes must
not repopulate those stores. Categories cannot form cycles; hidden ancestors
hide descendants. Published references must be removed before their
products/categories/media can be hidden or retired.

Draft reads preserve missing reference IDs and return them in
`unavailableMediaIds` so staff can repair the draft; they do not substitute
another asset. Save and publish reject invalid references. Unpublished
standalone artwork is returned in the authenticated draft's `media` list,
not leaked into the public snapshot.

## Pricing and reservation contract

Money is stored as database decimals and calculated with Prisma's existing
Decimal implementation. API money remains JSON numbers with at most two
decimal places, explicitly checked within the supported range; no browser
prices determine an order. Product/variant input is limited to KES 1 billion;
an aggregate amount must be below KES 1 trillion.

The compatibility pricing profile uses the following rules:

| Rule | Default |
|---|---|
| Currency and tax | KES; 16% VAT on merchandise after discounts, added at checkout; shipping is excluded from this VAT base |
| Automatic offers | Lowest eligible unit price; percentage/fixed offers do not compound; nearest KES 10, half-up, never above the base price or below zero |
| Coupons | Optional normalized code; percentage or one fixed amount across eligible merchandise; use it only if the eligible basket saves more than automatic offers |
| Coupon allocation and tax rounding | Exact cents; fixed allocation balances its final cent; tax rounds once, half-up |
| Delivery | STANDARD 200, SAME_DAY 500, STORE_PICKUP 200; retained legacy fee behavior, no free threshold or county restriction by default |
| Quote / inventory hold | 600 seconds / 900 seconds |

These retained delivery defaults are not a claim of commercial coverage.
Before live activation, confirm merchant fees/coverage and published policy.
`CHECKOUT_POLICY_JSON`, when supplied, replaces the whole profile and must
match the schema in `src/config/checkoutPolicy.js`. It contains `version`,
`currency`, `vatRate`, `discountStep`, `quoteSeconds`, `reservationSeconds`,
and all three delivery rules. Each delivery rule has `fee`, nullable
`freeAbove` and a `counties` list; an empty list imposes no county restriction.
Increase the version when changing policy. Any profile-content change also
changes its hash and invalidates unconsumed quotes.

Create a quote with a body such as:

```json
{
  "items": [{ "productId": "current-product-id", "variantId": "current-variant-id", "quantity": 1 }],
  "addressId": "owned-address-id",
  "deliveryMethod": "STANDARD",
  "couponCode": null,
  "notes": null
}
```

The response includes version 1, expiry, immutable quote lines, address,
coupon result, policy version/hash, VAT, shipping and total. IDs in the
example must be replaced by actual records; duplicate variants, unavailable
stock, another customer's address and invalid/expired coupons are rejected.
Catalog `variant.pricing` uses the same offer service; `stock` is available
units, while `onHand` and `reserved` expose their separate quantities.
Staff stock writes set on-hand quantity and cannot consume reserved units.

After reviewing the quote, send only `{"quoteId":"returned-id"}` with a
fresh `Idempotency-Key` (16-128 letters, digits, colons, underscores or
hyphens). First acceptance returns 201; the same customer/key/body returns
the existing order with 200, even after cancellation/expiry. Different
contents with the same key conflict. Another key cannot reuse a consumed
quote. The browser persists its request intent before sending and resolves
an unknown outcome before allowing a new submission.

Order creation, quote consumption, exact-variant holds, stock logs and
matching database-cart subtraction share one serializable transaction.
Price/address/policy changes return `QUOTE_CHANGED`; expired quotes return
`QUOTE_EXPIRED`. Both require a fresh customer review. Conflicting writes
return `ORDER_RETRY`; retry the same key, not a new order.

Cancellation/expiry release only the held units and never increment on-hand
stock for a new held order. Physical allocation is committed only through
the internal `commitOrderReservation` operation inside a future verified
payment transaction. A late payment after expiry returns
`RESERVATION_EXPIRED` for review; it does not acquire stock again.
The operation has no customer route and is not proof that the M-Pesa
integration has been completed. New-order emails explicitly state that
payment is pending and include the reservation expiry and stored discount.
