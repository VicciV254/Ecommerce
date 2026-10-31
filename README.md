# No Maneno Bazaar — E-Commerce Website

> **"IKO KITU!"** — There's always something for everyone.

No Maneno Bazaar is a full-featured e-commerce web application for a department store. Built with React, Vite, TypeScript, and Tailwind CSS.

![No Maneno Bazaar](public/images/logo.png)

---

## Overview

A modern e-commerce platform with both customer-facing store and admin dashboard. Features include product browsing, shopping cart, checkout, order tracking, and comprehensive inventory management.

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
use an automatically managed loopback Vite server and fixture API/media
responses, not the live site. The fixtures also cover newly opened tabs.
Interaction checks include narrow-phone/tablet drawer resizing, keyboard
search, modifier-click navigation, nested dialogs, focus restoration and
feedback inside active dialogs. Native dialog behavior is checked in the
browser, not simulated by jsdom. If Chromium is missing, install the project's
browser revision with `npx --no-install playwright install chromium`.

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
`apex_test_<id>` database, applies the real migrations and deletes only that
database in cleanup. Tests do not load `backend/.env` or send real email,
payments or image uploads.

The existing migrations include explicit `public` references, so integration
checks use a new database rather than just a new schema. Never point this
runner at Neon or another shared/production database.

`npm run typecheck`, `npm run lint`, `npm run test:unit` and their backend
counterparts can also be run separately. Fix failing checks rather than
replacing type checking with the Vite build.

## Development contracts

- Pass raw catalog products to `ProductCard`; it applies display stock and
  discounts once. Standalone product details and search suggestions use the
  same display helper. The base price remains separate from the displayed
  discount; this is not yet server-authoritative checkout pricing.
- Customer credentials are attached per request, never as a sticky Axios
  default. Concurrent customer 401s share a bounded refresh and each request
  retries at most once. Staff headers and public sign-in failures do not use
  customer refresh credentials. Superseded-session responses are cancelled;
  transient transport errors do not automatically sign out the customer.
- Use the shared `Link` for hash routes. It forwards anchor attributes and
  refs, respects a caller's `preventDefault`, and leaves modified clicks,
  alternate targets and downloads to the browser.
- Use `ModalDialog` or `ConfirmModal` instead of independent fixed overlays.
  They provide native modality, initial/restored focus, boundary Tab wrapping,
  Escape and backdrop dismissal. Guard `onClose` during pending operations,
  keep content viewport-bounded, and put feedback in the active dialog.
  The shared `Toast` follows the active dialog layer.

The storefront checkout is temporarily paused until server-authoritative
pricing and verified payment processing replace the legacy visual-payment
flow. Its cart action is disabled, and `POST /api/orders/checkout` returns
HTTP 503 before creating an address, order, item or tracking event. The
database-cart order API always creates pending orders, ignoring any
customer-supplied payment or fulfilment status.

Browsing, cart editing and existing order history remain available. The
checkout pause is deliberate and is not controlled by `ENABLE_MPESA`:
enabling a provider alone cannot make the old client-trusted flow safe.
Reintroduce checkout only with the planned trusted quote/order and verified
payment lifecycle. This checkpoint does not implement real M-Pesa payments.

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
