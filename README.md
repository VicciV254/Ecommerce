# No Maneno Bazaar — E-Commerce Website

> **"IKO KITU!"** — There's always something for everyone.

No Maneno Bazaar is a full-featured e-commerce web application for a department store. Built with React, Vite, TypeScript, and Tailwind CSS.

![No Maneno Bazaar](public/images/logo.png)

---

## Overview

A modern e-commerce platform with both customer-facing store and admin dashboard. Features include product browsing, shopping cart, checkout, order tracking, and comprehensive inventory management.

## Getting Started

### Prerequisites

- Node.js v18 or later
- npm

### Installation

```bash
git clone https://github.com/VicciV254/Ecommerce
cd Ecommerce
npm install
```

### Running the Application

**Backend:**

```bash
cd backend
npm install
npm run dev
```

The backend API will run on `http://localhost:5000`.

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
