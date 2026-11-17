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
| `FRONTEND_URL` | Public storefront origin used for links in customer emails |
| `BACKGROUND_JOBS_ENABLED` | Opt-in in-process maintenance for always-on hosts; defaults to `false` |
| `CRON_SECRET` | Bearer secret for `GET /api/internal/maintenance`; empty disables the endpoint |
| `CLOUDINARY_URL` | Server-only `cloudinary://<api_key>:<api_secret>@<cloud_name>`; empty disables image uploads |
| `CLOUDINARY_UPLOAD_PREFIX` | Upload folder and public-ID prefix; defaults to `apex-cart` |
| `RETURN_POLICY_JSON` | Optional complete validated return policy; empty uses `src/config/returnPolicy.js` defaults |
| `DEMO_NOTIFICATIONS_ENABLED` | Development/test-only opt-in to email customers about labelled demo orders |
| `ALLOW_DEMO_CATALOG` | Show labelled demo catalog records outside production; defaults to `false` |
| `ALLOW_DEMO_INITIALIZATION` | Explicit per-invocation consent for the local demo initializer |
| `ENABLE_ORDER_RESERVATIONS` | Permit pending-order inventory holds; defaults to `false`, never enables payment |
| `ALLOW_DEMO_ORDERS` | Additional development/test-only opt-in for demo orders, separate from catalog visibility |
| `CHECKOUT_POLICY_JSON` | Optional complete validated pricing profile; empty uses `src/config/checkoutPolicy.js` defaults |
| `ENABLE_MPESA` | Enables the order-linked Daraja integration only when all merchant, callback, limit and environment checks pass |
| `MPESA_LIVE_PAYMENTS_ENABLED` | Additional gate for the production API; defaults to `false`, but does not guarantee sandbox tests are money-free |
| `MPESA_MAX_AMOUNT` | Required approved whole-KES per-attempt limit; no implicit monetary limit |
| `MPESA_SANDBOX_ALLOWED_PHONES` | Required sandbox recipient allowlist, supplied privately |
| `MPESA_ALLOW_DEMO_SANDBOX` | Additional development/test sandbox opt-in; commercial orders are not paid by sandbox responses |
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
or payment-status claims. Creation requires explicit reservation enablement.
M-Pesa has a separate order-linked attempt lifecycle and enablement gate.
Refunds are recorded, not executed: staff send money outside the application,
then confirm it with the M-Pesa reference. A reservation or STK acknowledgement
is not payment or permission to fulfil an order.

Cloudinary, email and payment settings may remain empty/disabled
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

Set `BACKGROUND_JOBS_ENABLED=true` only on an intentional always-on host.
It runs due payment reconciliation every 15 seconds, and reservation expiry
and due email delivery every 60 seconds.
These services can mutate orders and send messages; they are not health
checks. A job does not overlap its previous invocation. `NODE_ENV=test`
always prevents background startup, even if the opt-in flag is set.

Serverless hosts run the same bounded steps through
`GET /api/internal/maintenance`. It returns 503 until `CRON_SECRET` is set
(16+ characters, no whitespace) and 401 unless the request carries exactly
`Authorization: Bearer <CRON_SECRET>`. `vercel.json` schedules it daily at
03:00 UTC, which Vercel runs for production deployments only; a Hobby plan
permits at most daily cron jobs. Each step is idempotent and reports only
counts or an error code. Hosted cron execution with this multi-service
configuration remains a release check.
Catalog, quote, stock and order reads also process an expiry batch, so
restarting a server does not lose held inventory. The batch is bounded to
100 expired orders; repeated requests or job ticks drain a backlog.
Orders never progress on a timer. Staff confirm processing, dispatch or
pickup readiness, and delivery or collection after payment is verified and
inventory is committed.

## Product and storefront images (Cloudinary)

An image is stored either as an HTTPS address or as a Cloudinary upload.
Uploads are optional: set `CLOUDINARY_URL` in `backend/.env` or the host's
secret settings to enable them. It stays on the server; never commit it,
paste it into chat or expose it through a `VITE_` variable.
`CLOUDINARY_UPLOAD_PREFIX` (default `apex-cart`) sets the upload folder.

ADMIN and SUPER_ADMIN staff call `POST /api/media/uploads` with
`{ "purpose": "PRODUCT" }` or `{ "purpose": "STOREFRONT" }`. The API signs
one upload with a random public ID under `<prefix>/products` or
`<prefix>/storefront`, `overwrite=false`, JPEG/PNG/WebP/AVIF only and a
3000px incoming size limit. The browser sends the file straight to
Cloudinary, so files never pass through the API (Vercel functions accept
request bodies of at most 4.5 MB). Saving the product, or `POST /api/media`,
then submits Cloudinary's upload result. The API checks its signature, folder,
format and size and builds the delivery address itself. Without
`CLOUDINARY_URL`, both return 503 `MEDIA_UPLOADS_DISABLED`.

A product image may name one of that product's variants. Cart, quote and
order lines keep the purchased variant's first image. Otherwise they use an
image not tied to any variant (its cover first), then the product cover.
Removing or replacing an image hides only that placement: the API never
deletes Cloudinary files, so shared assets and order history stay intact.
Uploads that are never saved stay in Cloudinary until removed manually.

Signed upload fields are valid for one hour and go only to editing staff.
Cloudinary does not tie the signature to the upload endpoint, so whoever
received them could, within that hour, delete and re-upload that one file
outside the app's edit history. Enable automatic backup (Cloudinary Console,
Settings > Backup; available on all plans, counts towards storage) so earlier
versions stay recoverable, and keep ADMIN accounts to trusted staff.

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
| `/api/settings/storefront/draft` | Staff draft with optimistic version checks (409 `STOREFRONT_CHANGED`), the live version's publisher (`publishedBy`), referenced media and unavailable media IDs |
| `POST /api/settings/storefront/publish` | Validate references and section headings, then atomically publish the current version, recording it as a revision with its publisher and time |
| `GET /api/settings/storefront/revisions` | Publication history for any signed-in staff member: newest first, 20 a page (`?page=`), each with its version, time, publisher (null when not recorded) and whether it is live; never the documents |
| `POST /api/settings/storefront/revisions/:version/restore` | SUPER_ADMIN and ADMIN copy a published version into the draft, sending the draft version they hold (`{ "version": n }`); 409 `STOREFRONT_CHANGED`, 404 `REVISION_NOT_FOUND`, 409 `REVISION_INVALID` (breaks current rules) or 409 `REVISION_UNAVAILABLE` (uses a deleted product, category or image) change nothing; shoppers see the version only after the next publish |
| `GET /api/admin/activity` | Staff activity for SUPER_ADMIN and ADMIN: sign-ins and staff changes that have no history of their own, newest first, 25 a page (`?type=all\|signins\|storefront\|catalog\|discounts\|customers\|promotions&page=`); never IP addresses, user agents or emails |
| `POST /api/media` | Staff URL/provenance registration; external uploads remain separate |
| `POST /api/orders/quotes` | Authenticated, versioned, expiring server quote from IDs and customer choices |
| `GET /api/orders/quotes/:id` | Owner-only saved quote, including consumed/expired state for retry recovery |
| `POST /api/orders`, `POST /api/orders/checkout` | `{quoteId}` plus `Idempotency-Key`; create or replay an unpaid order atomically |
| `POST /api/orders/:id/cancel` | Owner cancellation before dispatch; releases or restocks units once; a paid order records a refund request |

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

Section headings may not claim a ranking or popularity the store does not
measure (for example "best sellers", "top rated" or "trending"): saves and
publishes refuse them with 400, and restores refuse versions that use them.
A stored document that contains such a heading still loads, so staff can fix it.

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
The operation has no customer route and is called only by verified payment
finalization. New-order emails explicitly state that payment is pending and
include the reservation expiry and stored discount.

## Order-linked M-Pesa

`ENABLE_MPESA=false` remains the default. The integration uses the existing
Axios client to call Safaricom's OAuth, STK Push and STK Query endpoints. It
does not install another commerce platform or payment SDK. Local automated
checks use an explicitly injected provider double; `NODE_ENV=test` rejects
the real network transport even if credential variables were supplied.
`MPESA_SANDBOX_SIMULATE=true` is rejected, not treated as payment success.

**Sandbox STK is not a guaranteed money-free dry run.**
[Safaricom's FAQ](https://developer.safaricom.co.ke/faqs), under "Is there a
refund to the test funds for STK push?", describes test-fund reversal at
6 a.m. the next day. Treat a handset test as a possible debit: agree the
authorized recipient and amount before sending a prompt, and verify the
provider's current test terms. The application cannot guarantee reversal
timing. A published sample phone number is not proof of a reachable test
recipient.

Before an **approved sandbox run**, configure the following privately:

- `MPESA_ENVIRONMENT=sandbox`, the merchant consumer key/secret, shortcode,
  passkey and applicable `MPESA_TRANSACTION_TYPE`.
- `MPESA_CALLBACK_URL`: a public HTTPS URL ending in `/api/mpesa/callback`.
  Each attempt appends a random ID and unguessable callback key; do not
  log that complete URL in a proxy, CDN, access log, screenshot or error.
  The database stores only a hash of the callback key.
- `MPESA_MAX_AMOUNT`, the separately approved test limit, and
  `MPESA_SANDBOX_ALLOWED_PHONES`, the agreed recipient list.
- `MPESA_ALLOW_DEMO_SANDBOX=true` plus the ordinary local demo/order flags.
  Sandbox settlement is accepted only for demo orders. A sandbox response
  cannot mark a commercial order paid, and a demo order cannot use live mode.

Live mode additionally requires `NODE_ENV=production`,
`MPESA_ENVIRONMENT=production` and `MPESA_LIVE_PAYMENTS_ENABLED=true`.
Onboarding, merchant eligibility, amount limits, callbacks and real receipt
correlation still require an actual authorized provider verification.
Setting flags is not proof of production readiness and does not authorize a
test charge. Never enter a PIN or provider secret in the storefront or chat.

STK amounts use the exact saved order total. Positive fractional-KES totals
return `MPESA_AMOUNT_UNSUPPORTED`; the application never rounds the order or
changes its VAT to make it chargeable. The commercial rounding/payment policy
must be agreed separately if cent totals should be supported.

| Route | Purpose |
|---|---|
| `GET /api/mpesa/orders/:orderId/payments` | Owner's attempt list, current order state and server-calculated initiation availability; no provider call |
| `POST /api/mpesa/stk-push` | `{orderId, phone}` and `Idempotency-Key`; create/replay one durable attempt using the order's amount |
| `GET /api/mpesa/payments/:id` | Owner-only safe attempt status |
| `POST /api/mpesa/payments/:id/query` | Reconcile the existing attempt; never sends another STK prompt |
| `POST /api/mpesa/callback/:id/:key` | Correlated provider evidence ingestion; acknowledges only after database persistence |
| `GET /api/mpesa/admin/orders/:orderId/payments` | Staff/viewer read-only overview with masked phone and safe reason codes |
| `POST /api/mpesa/admin/payments/:id/query` | ADMIN/SUPER_ADMIN reconciliation; not force-paid/refund approval |

The former uncorrelated `/mpesa/callback` endpoint stays unavailable. Callback
requests have a 32 KiB JSON limit, a separate rate limit and a per-attempt
evidence cap. Application access logging omits M-Pesa URLs (including
case-variant paths), and database/provider errors are reduced to safe codes;
full provider payloads, credentials and callback keys must not be logged.

Each attempt is recorded before the provider request. An accepted prompt
remains pending. Network timeout, missing provider IDs or lost response
persistence remains unknown; the same customer/request key returns that
attempt without sending another prompt. A new key cannot bypass an unresolved
attempt. New prompts following confirmed failure need an explicit customer
action, a cooldown and the server's attempt limit.
The browser keeps a normalized phone and request key in account/order-scoped
storage only while resolving an unknown submission. If that browser never
returns, this local intent can remain until its site data is removed; the
database remains the payment authority. No PIN or callback key is stored in
the browser.

Callbacks are **not assumed to carry a Daraja signature**. The per-attempt
URL is a correlation credential, not a claim that Safaricom signs the body.
Callback evidence alone never settles an order. Finalization requires a
successful authenticated STK query matching the attempt's provider IDs,
plus matching callback amount, phone, unique receipt and transaction-date
evidence. Missing receipt evidence, conflicting results/IDs or receipt reuse
stays in review. An STK query acknowledgement without a final result is not
success; unrecognized results remain unknown instead of enabling another
charge.
Turning off new M-Pesa requests does not discard evidence arriving for an
already-issued correlated callback; it remains durable for later authorized
reconciliation.

Successful verification persists the receipt, payment state, stock commitment
and order history atomically. It does not advance fulfilment. Duplicate or
reordered callbacks cannot repeat stock or payment effects. A verified payment
after cancellation/expiry records received money and review status without
reopening the order or reacquiring inventory. A conflicting callback cannot
downgrade a previously confirmed payment. Confirmation queues the
payment-confirmed email in the same transaction; refunds are separate records
that staff confirm only after sending money (see below).
Payment finalization, cancellation and expiry lock the order before its stock
rows to avoid opposite-lock-order deadlocks. A payment review blocks
fulfilment/pickup shortcuts. The payment overview expires overdue holds
without calling the provider; the UI stops inviting PIN approval for inactive
orders and refreshes the open receipt immediately after cancellation.

Reconciliation persists a lease/cooldown and works after restart. Its optional
job processes at most five due attempts per tick and has a bounded automatic
query count; customer/staff checks use the same guarded service. An unknown
initiation with no provider reference is not safely replayable upstream and
may require merchant portal review. No callback retry guarantee is assumed.
Customers and staff can explicitly check pending attempts. Always-on hosts
can also run the optional job; serverless hosts rely on the daily maintenance
endpoint as the backstop.

Public protocol references: [Daraja portal](https://developer.safaricom.co.ke/apis)
and [Safaricom's official Node examples](https://github.com/safaricom/mpesa-node-library).
The official examples are reference material, not an installed SDK. Some old
documentation links currently return 404, and the public portal did not
establish current callback-authentication guarantees during implementation.
Verify the precise merchant/environment contract in an authorized sandbox
flow before enabling production.

### Isolated local sandbox callback

For a local sandbox tunnel, use the separate callback-only listener instead
of forwarding the main API port. It mounts the same bounded callback
validation/persistence route but rejects storefront, health, authentication,
staff and payment-initiation routes. It binds only to `127.0.0.1`.

The private environment file must set `NODE_ENV=development`,
`MPESA_ENVIRONMENT=sandbox`, `MPESA_LIVE_PAYMENTS_ENABLED=false`,
`BACKGROUND_JOBS_ENABLED=false` and `ENABLE_SANDBOX_CALLBACK=true`. Both
database URLs must identify the same approved loopback development database.
`SANDBOX_CALLBACK_PORT` defaults to 4285. Keep `ENABLE_MPESA=false` while
preparing credentials and callback reachability.

```bash
node --env-file=/absolute/private/sandbox.env backend/scripts/start-sandbox-callback.js
```

Use the provider's normal user-level ngrok credential store, with a separate
sandbox overlay that disables local request inspection and agent logs. Point
the tunnel only at the callback listener, never the main API or database.
Verify that `/api/health`, `/api/catalog`, `/api/admin` and `/api/auth/login`
are unavailable through the public endpoint. A synthetic invalid callback
key can verify handler reachability without creating a payment.

Ngrok necessarily handles the public callback traffic; disabling local
inspection is not a guarantee about the provider's own operational metadata.
Keep the generated environment and database credentials outside the working
tree with owner-only permissions. Do not copy real credentials into docs,
commands shown in chat, or `.env.example`. The actual sandbox database volume
must survive service stops; verification databases are separate and disposable.

## Fulfilment, returns, refunds and notifications

Staff move orders explicitly with
`POST /api/orders/admin/:id/actions` and
`{ action, expectedStatus, reason?, trackingNumber? }` (ADMIN/SUPER_ADMIN).
A stale `expectedStatus` returns `ORDER_CHANGED`; an action that is not valid
for the current state returns `ACTION_NOT_ALLOWED`. Every step records the
acting staff member, timestamp and history entry.

| Action | Transition | Conditions |
|---|---|---|
| `START_PROCESSING` | PENDING -> PROCESSING | Paid, inventory committed, no open payment review |
| `MARK_READY_FOR_PICKUP` | PROCESSING -> READY_FOR_PICKUP | Store pickup only |
| `DISPATCH` | PROCESSING -> SHIPPED | Standard or same-day delivery; optional tracking number |
| `CONFIRM_DELIVERY` | SHIPPED -> DELIVERED | Starts the return window |
| `CONFIRM_PICKUP` | READY_FOR_PICKUP -> DELIVERED | Records collection; starts the return window |
| `CANCEL` | PENDING, PROCESSING or READY_FOR_PICKUP -> CANCELLED | Reason required; a paid order records a refund request for the money not yet refunded |

Customers can cancel only while an order is PENDING or PROCESSING, before
dispatch or pickup readiness. Customers cannot mark an order collected or
delivered.

Public tracking (`GET /api/orders/track/:number`, no sign-in) lists only status
changes with fixed wording. Refund amounts, M-Pesa references, locations and
staff notes appear only in the signed-in customer's and staff views.

### Return policy

The default policy allows refund-only returns of selected items for 7 days
after delivery or collection. Perishable groceries and innerwear can be
returned only when faulty, damaged or wrong. Opened personal-care and hygiene
items are returnable only for those reasons; other reasons require an unopened
declaration that staff verify on receipt. Categories inherit the nearest
explicit `returnRule` (`STANDARD`, `FAULT_ONLY` or `UNOPENED_OR_FAULT`).
New orders snapshot the policy and each line's rule, so later edits do not
change existing orders.

Refunds cover accepted units at their discounted, VAT-inclusive price. The
delivery fee is refunded only when staff confirm a merchant fault and no
earlier refund included it. Amounts round up to whole KES and never exceed
the money received. `RETURN_POLICY_JSON`, when supplied, replaces the whole
policy and must match `src/config/returnPolicy.js`: `version`, `windowDays`
(1-365), `deliveryFeeRefund` (`MERCHANT_FAULT_ONLY`, `ALWAYS` or `NEVER`),
`partialReturns`, and the fixed `refundRounding`, `resolutions` and
`refundMethod` values. Increase the version when changing it. Merchant
confirmation of the published wording remains a release check.

| Route | Contract |
|---|---|
| `POST /api/orders/:id/returns` | Owner request with `Idempotency-Key`; `{ reason, comment?, unopenedDeclared?, lines: [{ orderItemId, quantity }] }` |
| `POST /api/orders/:id/returns/:returnId/cancel` | Owner withdrawal while the request is still REQUESTED |
| `GET /api/orders/admin/returns` | Staff list, filterable by status |
| `POST /api/orders/admin/returns/:returnId/decision` | Approve or reject; rejection requires a note |
| `POST /api/orders/admin/returns/:returnId/receive` | Record received, restocked and refundable quantities; restocks once and requests the refund |
| `GET /api/orders/admin/refunds` | Staff list, filterable by status |
| `POST /api/orders/admin/refunds/:refundId/:action` | `approve`, `start`, `confirm`, `fail`, `unresolved`, `retry` or `cancel` with `expectedStatus` |
| `POST /api/orders/admin/payments/:paymentId/refunds` | Refund request for money received on a payment under review |
| `POST /api/orders/admin/:id/refunds` | Request money still owed again: `{ source: CANCELLATION, reason }` for a cancelled paid order, or `{ source: RETURN, returnId, reason }` for a received return; offered in the staff order's `refundRequestOptions` |

Refunds move REQUESTED -> APPROVED -> PROCESSING -> CONFIRMED, FAILED or
UNRESOLVED. Approval never means money was sent. Confirmation requires the
unique M-Pesa reference (8-32 uppercase letters or digits) and only then
updates the order to PARTIALLY_REFUNDED or REFUNDED. Cancelling a refund
records that the money is not being sent through it; if it is still owed, staff
can request it again from the order, capped at the paid balance that remains.

### Customer email and staff attention

Business transactions write durable notification rows; delivery happens after
commit with a bounded wait. Failures remain visible and retry with backoff
until the attempt limit, after which ADMIN/SUPER_ADMIN staff can retry with
`POST /api/admin/notifications/:id/retry`. Delivery is at-least-once, so a
customer could rarely receive a duplicate after a provider timeout. Emails use
the existing SMTP/Gmail settings and `FRONTEND_URL` links; demo orders send no
email unless `DEMO_NOTIFICATIONS_ENABLED=true` outside production.

`GET /api/admin/attention` lists orders awaiting fulfilment, payment reviews,
returns awaiting a decision or receipt, refunds needing action and failed
emails. `POST /api/admin/attention/read` with `{ keys }` stores per-staff read
state; reading never resolves the underlying work.

### Upgrading existing data

Migration `20261114120000_fulfilment_returns_refunds` stops with an error if
any order or tracking event still uses the removed `AWAITING_REFUND` or
`RETURNED` statuses, and applies none of its changes. Resolve those orders
explicitly (a paid order cancelled this way then offers a refund request for
the money still owed), mark the failed attempt with
`npx prisma migrate resolve --rolled-back 20261114120000_fulfilment_returns_refunds`
(from `backend/`, against the same database), then deploy again. The migration
links each paid order to its confirmed payment and applies the approved
category return rules by slug.
