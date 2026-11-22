# Testing

Run these checks from the repository root. None of them needs a hosted service, real credentials or `backend/.env`.

| Command | What it runs |
|---|---|
| `npm run check` | TypeScript (`tsc --noEmit`), ESLint, the Vitest tests in `src/`, then the production build |
| `npm --prefix backend run check` | Prisma Client generation, ESLint, then the Node tests in `backend/test/unit/` |
| `npm run test:e2e` | The Playwright tests in `tests/e2e/`, at phone and desktop sizes |
| `npm --prefix backend run test:integration` | The API and database tests in `backend/test/integration/`, against a test database (see below) |

To run one part of a check, use `npm run typecheck`, `npm run lint` or `npm run test:unit` for the frontend, and
`npm --prefix backend run lint` or `npm --prefix backend run test:unit` for the backend.

## Browser tests

`npm run test:e2e` builds the frontend into `.cache/e2e-preview-<port>/` and serves it with `vite preview` at
`http://127.0.0.1:4173` by default. Each test runs in two Playwright projects: `mobile` (390 × 844, touch) and
`desktop` (1280 × 900).

No backend runs. Fixtures in `tests/e2e/` answer the API and media requests, including those from tabs a test opens.
They also serve the site's own fonts, Jost and Marcellus, from `tests/e2e/brand-fonts/` in place of Google Fonts, so
text is laid out as shoppers see it. The fonts are under the SIL Open Font License 1.1: see
[tests/e2e/brand-fonts/OFL.txt](../tests/e2e/brand-fonts/OFL.txt).

If Chromium isn't installed, install the version this project's Playwright expects:

```bash
npx --no-install playwright install chromium
```

The preview server doesn't move to another port when its port is taken; it stops. To run beside another server, pick
a free port from 1024 to 65535. The server, the browser and the fixtures all follow it:

```bash
E2E_PORT=4274 npm run test:e2e
```

## Database integration tests

These tests need Docker. Start the test database, run the tests, then stop the database:

```bash
docker compose -p apex-tests -f compose.test.yml up --detach --wait
TEST_DATABASE_URL=postgresql://apex_test:local_test_only@127.0.0.1:55432/apex_test npm --prefix backend run test:integration
docker compose -p apex-tests -f compose.test.yml down
```

`compose.test.yml` runs PostgreSQL 15 on loopback port 55432 with temporary storage, so `down` discards its data. On a
shared machine, give your stack its own project name with `-p` and stop only that one.

For each test file, the runner creates a database named `apex_test_<random>`, applies the real migrations, runs the
file and drops that database. It uses a whole database rather than a schema because some migrations name the `public`
schema. The role in `TEST_DATABASE_URL` therefore needs permission to create databases; the one in `compose.test.yml`
has it. To run one file, add its name:

```bash
TEST_DATABASE_URL=postgresql://apex_test:local_test_only@127.0.0.1:55432/apex_test npm --prefix backend run test:integration -- catalog.test.js
```

In test mode the API doesn't load `backend/.env`. `backend/test/setup-env.js` sets test values and clears the email,
M-Pesa and Cloudinary settings, and the M-Pesa client refuses real network calls when `NODE_ENV=test`.

### When the runner refuses

The runner prints `Integration checks refused or failed:` and the reason.

| Reason | What to do |
|---|---|
| `TEST_DATABASE_URL is required` | Set `TEST_DATABASE_URL` as in the commands above. |
| `TEST_DATABASE_URL must target a loopback host for local database operations` | Use `localhost`, `127.0.0.1` or `[::1]`. The runner connects to no other host. |
| `TEST_DATABASE_URL must name an apex_test database`, or `... an apex_test or apex_development database` | Name the database `apex_test`, or `apex_test_` followed by lowercase letters and digits. |
| `Choose an existing integration test filename` | Use a file name from `backend/test/integration/`, such as `catalog.test.js`. |

## Continuous integration

`.github/workflows/checks.yml` runs on every push and pull request. The frontend job runs `npm run check` and the
browser tests. The backend job runs `npm run check` and the integration tests in `backend/`, against a PostgreSQL 15
service.
