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

Keep signing secrets in the local environment or an approved secret store,
not in source, terminal transcripts or chat. Server startup rejects missing
required values and placeholder/short signing secrets before connecting.

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
have `CREATEDB` permission, as the provided local service does. Each run
creates and drops only its randomly named test database, preserving the
configured base database. Whole-database isolation is intentional: some
migrations explicitly reference the `public` schema.

## Legacy destructive seed/reset

The current seed deletes records before creating its legacy catalog. It is
not required for the automated checks and is not the future idempotent
demo-catalog initializer.

Both raw seed execution and `npm --prefix backend run reset` refuse to run
unless all of these hold:

- `NODE_ENV` is `development` or `test`.
- `ALLOW_LOCAL_DATABASE_RESET=true` is explicitly supplied for that invocation.
- `DATABASE_URL` and `DIRECT_URL` identify the same loopback database/schema.
- The database name is `apex_development`, `apex_test` or one of their
  underscore-suffixed local variants.

Seed also requires `ADMIN_PASSWORD` of at least 12 characters. There is no
hardcoded seeded admin password and passwords are never printed. Reset
does not automatically seed.

If a developer deliberately needs this operation, run it from the host
against the example loopback connection, not from inside the application
container or against a shared database:

```bash
ALLOW_LOCAL_DATABASE_RESET=true npm --prefix backend run seed
# Or, to reset schema without seeding:
ALLOW_LOCAL_DATABASE_RESET=true npm --prefix backend run reset
```

The old hosted database being disposable does not authorize these commands
to contact it. Hosted-resource deletion and production connection changes
remain separate operations.
