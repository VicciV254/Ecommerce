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

The legacy `POST /api/orders/checkout` endpoint is deliberately unavailable:
authenticated calls return HTTP 503 before any checkout writes. It must be
replaced with trusted pricing and payment verification, not reopened by a
provider environment flag. The separate database-cart `POST /api/orders`
path always creates an unpaid, pending order; request payment/status claims
are not settlement evidence.
Cancellation restores the saved variant allocation, not every SKU belonging
to a product. Stock/status/log changes and cancellation share a serializable
transaction; incomplete allocations are rejected without partial writes.
Legacy M-Pesa handlers also remain unavailable until payments are linked to
trusted orders and verified provider outcomes. Demo products cannot enter
commercial order creation even when their catalog preview is enabled.

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
environment. It enables the existing auto-stage job every 10 seconds, refund
notification job every 60 seconds and optional image-host session work.
These services can mutate orders and send messages; they are not health
checks. A job does not overlap its previous invocation. `NODE_ENV=test`
always prevents background startup, even if the opt-in flag is set.

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
