# Apex Cart

Apex Cart is a personal demonstration project: an online store for shoppers and an administration app for its staff.
Nothing is really sold: the products are samples, paid for with a demonstration payment or in Safaricom's M-Pesa
sandbox.

## Overview

Shoppers browse departments and products, fill a cart, check out against a quote that the server calculates, and
track their orders. Staff use the administration app at `#/admin` to run the catalog, stock, homepage, discounts,
orders, returns and refunds. The server owns every price, quote and stock hold, so the browser never calculates a
total. In demonstration mode the store sells only sample products, takes a demonstration payment that moves no money,
and lets shoppers play the store's part for their own orders.

## Getting started

### Prerequisites

- Node.js 24.22.1 (pinned in `.nvmrc`) and npm 11.19.1
- Docker with the Compose plugin, for the local PostgreSQL 15 database

### Install

```bash
git clone https://github.com/VicciV254/Ecommerce
cd Ecommerce
npm ci
npm --prefix backend ci
npm --prefix backend run build
```

### Configure

Copy the example settings, skipping any file you already have:

```bash
cp .env.example .env.local
cp backend/.env.example backend/.env
```

Then edit `backend/.env` ([Backend setup](backend/SETUP.md) describes every setting):

- Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to two different values of at least 32 characters. Generate each with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- Set `ADMIN_EMAIL`, `ADMIN_USERNAME` and an `ADMIN_PASSWORD` of at least 12 characters for the first staff account.
- Set `ALLOW_DEMO_CATALOG=true` to show the sample catalog in your local store.
- To place sample orders as well, set `DEMONSTRATION_STORE=true` and `ENABLE_ORDER_RESERVATIONS=true`.

### Run

Start PostgreSQL, apply the migrations, preview and create the sample data, then start the API:

```bash
docker compose --env-file backend/.env up --detach --wait postgres
npm --prefix backend run migrate:deploy
npm --prefix backend run seed:demo -- --dry-run
ALLOW_DEMO_INITIALIZATION=true npm --prefix backend run seed:demo
npm --prefix backend run dev
```

In a second terminal, start the storefront:

```bash
npm run dev
```

The API listens on `http://127.0.0.1:5000` and the store is at `http://localhost:5173`. Staff sign in at
`http://localhost:5173/#/admin` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Verification

```bash
npm run check                   # frontend: types, lint, unit tests, build
npm --prefix backend run check  # backend: Prisma Client, lint, unit tests
npm run test:e2e                # browser tests at phone and desktop sizes
```

The browser tests need Playwright's Chromium, and the database integration tests need Docker. See
[Testing](docs/testing.md) for both.

## Tech stack

- Frontend: React 19.2, TypeScript 5.9, Vite 7.3 (single-file build), Tailwind CSS 4.1
- Backend: Node.js 24, Express 4.22, Prisma 5.22, PostgreSQL 15
- Tests: Vitest 5, Playwright 1.64, the Node.js test runner
- Optional services: Cloudinary (image uploads), SMTP or Gmail (email), Safaricom Daraja (M-Pesa)

## Project structure

```text
.
├── src/                  # React app: storefront and staff app
│   ├── api/              # HTTP clients for the API
│   ├── components/       # Shared UI components
│   ├── pages/            # Storefront pages; admin/ holds the staff app
│   └── store/            # Cart, checkout, catalog and storefront state
├── backend/              # Express API; see backend/SETUP.md
│   ├── prisma/           # Database schema and migrations
│   ├── scripts/          # Sample-data initializer, local reset, sandbox callback listener
│   ├── src/              # Routes, controllers, services and configuration
│   └── test/             # Unit and integration tests
├── tests/e2e/            # Playwright browser tests and fixtures
├── public/               # Icons, brand images, link-preview image, robots.txt
├── docs/                 # Frontend and testing guides
├── docker-compose.yml    # Local PostgreSQL, API and frontend containers
└── compose.test.yml      # Throwaway PostgreSQL for integration tests
```

## Docs

- [Backend setup](backend/SETUP.md): configuration, local database, background jobs, images, API routes, pricing,
  M-Pesa, fulfilment and the demonstration store
- [Frontend](docs/frontend.md): routes, sessions, checkout, the storefront editor, information pages and the staff app
- [Testing](docs/testing.md): what each check runs, browser tests and database integration tests
- Credits: the brand fonts Jost and Marcellus are under the [SIL Open Font License](tests/e2e/brand-fonts/OFL.txt);
  the sample product photos come from Unsplash and Pexels, credited per image in
  [backend/src/data/placeholderMedia.js](backend/src/data/placeholderMedia.js)
