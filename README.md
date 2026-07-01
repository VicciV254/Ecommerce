# No Maneno Bazaar — E-Commerce Website

> **"IKO KITU!"** — There's always something for everyone.

No Maneno Bazaar is a full-featured e-commerce web application for a department store located on Digo Road, Mombasa CBD, Kenya. Built with React, Vite, TypeScript, and Tailwind CSS.

![No Maneno Bazaar](public/images/logo.png)

---

## Table of Contents

- [Features](#features)
- [Pages Overview](#pages-overview)
- [Getting Started](#getting-started)
- [Admin Dashboard](#admin-dashboard)
- [Product Catalog](#product-catalog)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)

---

## Features

### Customer-Facing Store
- **Product Browsing** — 100 products across 10 categories with real product photography
- **Filtering & Search** — Filter by category, price range, size, color; sort by price or rating
- **Product Details** — Full product pages with image gallery, size/color selectors, stock indicators, reviews, and related products
- **Shopping Cart** — Add/remove items, adjust quantities, apply promo codes (try `IKOKITU` for 10% off)
- **Wishlist** — Save products for later with heart toggle on every product card
- **Multi-Step Checkout** — 3-step flow: Shipping → Delivery Method → Payment (M-Pesa, Card, Bank Transfer, Cash on Delivery)
- **Order Tracking** — Track orders with a visual timeline. After payment, a 3-second popup invites you to copy your tracking code (with Copy / Cancel options) before continuing or tracking your order
- **Responsive Design** — Fully responsive across mobile, tablet, and desktop
- **Persistent State** — Cart, wishlist, and stock changes are saved to `localStorage`

### Admin Dashboard
- **Dashboard Overview** — Key metrics: total products, orders, revenue, low/out-of-stock alerts
- **Inventory Analytics** — Category-by-category inventory value breakdown with visual charts
- **Discount Management** — Apply preset (5–50%) or custom percentage discounts to all products or filtered by category
- **Stock Management** — Inline stock editing per product, bulk add/subtract/set for filtered or all products simultaneously
- **Order Management** — View recent orders with status indicators
- **Customization** — Customize brand colors, fonts, and theme
---

## Pages Overview

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` or `/#/` | Hero carousel, category grid, best sellers, spotlights, reviews |
| Shop | `/#/shop` | Full product grid with sidebar filters, sorting, pagination |
| Product Detail | `/#/product/{id}` | Individual product page with full details |
| Cart | `/#/cart` | Shopping cart with promo code support |
| Checkout | `/#/checkout` | 3-step checkout (Shipping → Delivery → Payment) |
| Order Confirmation | (after checkout) | Order number with copy-to-clipboard, track order link |
| Track Order | `/#/track` | Order tracking with visual timeline |
| Wishlist | `/#/wishlist` | Saved products |
| About | `/#/about` | Store story, floor guide, values |
| Contact | `/#/contact` | Contact form, store info, map link |
| **Admin Dashboard** | `/#/admin` | **Staff-only** — see below |

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node.js)

### Installation

```bash
# 1. Clone or download the project
git clone https://github.com/VicciV254/Ecommerce
cd ecommerce

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will open at `http://localhost:5173`.

### Building for Production

```bash
npm run build
```

The production build is output to the `dist/` folder as a single HTML file (via `vite-plugin-singlefile`), ready to deploy to any static hosting provider.

### Preview the Production Build

```bash
npm run preview
```

## Admin Dashboard

The admin dashboard is a separate interface accessible at:

```
/#/admin
```

It is intentionally **not linked in the main navigation** for security. Access it by:

1. **Typing `/#/admin` in the browser address bar**, or
2. **Clicking the "Staff Portal" link** at the very bottom of the website footer (subtle, small text)

### Admin Features

| Tab | What It Does |
|-----|-------------|
| **Dashboard** | Overview metrics — product count, active discounts, revenue, low/out-of-stock alerts |
| **Discounts** | Create, edit, and stop discounts (see below) |
| **Stock** | View and edit stock levels inline. Bulk actions: add, subtract, or set stock for filtered results or ALL products at once |
| **Catalog** | Add new products, edit existing ones (full editor), manage/delete tags, categories & designers (see below) |
| **Customize** | Change website fonts (6 options) and color theme (5 presets + custom color picker). Reset to defaults anytime |
| **Orders** | View recent orders with customer info and status |
| **Analytics** | Detailed inventory value breakdown by category |

### Catalog Management (full product editor)

The **Catalog** tab gives full control over products, categories, designers, and tags:

- **Add a new product** — name, category (dropdown, with **+ Add new category…**), price, designer (dropdown, with **+ Add new designer…**), overview image, 4 detail images, and tags.
- **Browse & edit** — Pick a category to filter, then click any product card to open the **full-screen Product Editor** (similar layout to the customer-facing product detail page).
- **Inside the editor:**
  - **← / → arrows** at the top navigate through products in the currently-selected category.
  - Edit **all fields** — name, price, all images (overview + 3 detail), category (dropdown + **+ New**), designer (dropdown + **+ New**), tags, description.
  - **Preview** button toggles between Editing View and a Preview that shows the product exactly as customers will see it (hero image with swappable angle thumbnails, name, price, tags, designer credit, description).
  - **Apply** stages the edits in the draft. Click **Save Changes** in the top bar to publish.
  - For custom (admin-added) products, a **Remove** button is available.
- **Create new categories** — name + header image URL. They appear in every category dropdown across the admin and become a real category in the live store after Save.
- **Create new designers** — full form with:
  - Designer ID (one word, e.g. `amina`)
  - Full Name (e.g. *Amina Mohamed*)
  - Specialty (e.g. *Silk Scarves*)
  - Location (optional, defaults to *Mombasa*)
  - Profile image URL (optional)
  - **Spotlight Heading** and **short description** — these populate the Designer Spotlight card on the Showroom page, exactly like the built-in resident designers
  - New designers appear in the designer dropdowns, become filterable in the Shop's "Shop by Designer" group, and are added to the Showroom → Designer Collaborations section with their spotlight card.

### Working with Drafts, Save, Undo & Redo

The admin uses a **draft system** — all your edits (stock and discounts) are staged as a *draft* and do **not** affect the live store until you explicitly save.

- **Save Changes** — A button in the top bar (highlighted when you have unsaved edits). A confirmation popup appears before publishing to the live store.
- **Undo / Redo** — Arrow buttons in the top bar step backward/forward through your unsaved edits.
- **Unsaved indicator** — An "Unsaved changes" badge shows when your draft differs from the live data.
- **Exit protection** — If you try to leave with unsaved changes, you'll be asked to confirm before discarding.

### Discount Management

In the **Discounts** tab you can:

1. **Create a discount** targeting:
   - **All** products
   - A specific **Category**
   - **Individually picked products** (searchable, multi-select list with thumbnails)
2. Set the **percentage** (presets 5–50% or custom) and a **duration** (start & end dates).
3. **Review all current discounts** — each shows whether it's *Active* or *Scheduled/Ended*, how many products it affects, and its date range.
4. For any existing discount you can:
   - **Update the percentage**
   - **Extend the end date**
   - **Stop (remove) the discount** (with confirmation)

When a discount is active, its price is automatically applied across the store, and a `-X%` badge appears on affected product cards.

> **Confirmation popups** appear before adding/stopping discounts and before bulk stock updates and saving — so nothing changes by accident.

> **Note:** All saved data persists in `localStorage`. To reset to defaults, clear your browser's local storage for the site.

---

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| [React 19](https://react.dev) | UI framework |
| [TypeScript](https://www.typescriptlang.org) | Type safety |
| [Vite](https://vitejs.dev) | Build tool & dev server |
| [Tailwind CSS 4](https://tailwindcss.com) | Utility-first styling |
| `localStorage` | Client-side persistence for cart, wishlist, stock |


## Project Structure

```
├── public/
│   └── images/
│       └── logo.png              # Brand logo
├── src/
│   ├── components/
│   │   ├── Header.tsx            # Sticky header with nav, search, cart
│   │   ├── Footer.tsx            # Newsletter, links, contact info
│   │   └── ui.tsx                # Reusable components (ProductCard, Stars, etc.)
│   ├── data/
│   │   └── products.ts           # Full product catalog, categories, images
│   ├── pages/
│   │   ├── Home.tsx              # Landing page with hero, categories, spotlights
│   │   ├── Shop.tsx              # Product grid with filters & pagination
│   │   ├── ProductDetail.tsx     # Individual product page
│   │   ├── Cart.tsx              # Shopping cart
│   │   ├── Checkout.tsx          # Multi-step checkout & confirmation
│   │   ├── TrackOrder.tsx        # Order tracking with timeline
│   │   ├── Wishlist.tsx          # Saved items
│   │   ├── About.tsx             # About the store
│   │   ├── Contact.tsx           # Contact form & info
│   │   └── Admin.tsx             # Admin dashboard (separate interface)
│   ├── store/
│   │   └── StoreContext.tsx      # Global state (cart, wishlist, stock)
│   ├── router.tsx                # Hash-based SPA router
│   ├── App.tsx                   # Root component with routing
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Tailwind config & global styles
├── index.html                    # HTML shell with Google Fonts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Promo Codes

| Code | Discount |
|------|----------|
| `IKOKITU` | 10% off entire cart |
