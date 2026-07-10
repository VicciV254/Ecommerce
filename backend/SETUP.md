# Backend Setup Instructions

## Environment Variables (IMPORTANT!)

You must create a `.env` file in the backend directory manually. This file is gitignored for security reasons.

Create `backend/.env` with the following content:

```env
# Database (matches Docker Compose configuration)
DATABASE_URL=postgresql://nomaneno:nomaneno123@localhost:5432/nomaneno_bazaar

# JWT Secrets (change these in production!)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production

# Server
PORT=5000
NODE_ENV=development

# Image Host API (Session-based authentication with cookies)
IMAGE_HOST_API_URL=https://my-image-host.victor-f6f.workers.dev/api
IMAGE_HOST_LOGIN_URL=https://my-image-host.victor-f6f.workers.dev/api/login
IMAGE_HOST_USERNAME=your_image_host_username
IMAGE_HOST_PASSWORD=your_secure_password_here
IMAGE_HOST_UPLOAD_PRESET=no_maneno_products
IMAGE_HOST_FOLDER=products
IMAGE_HOST_SESSION_REFRESH=45

# Admin
ADMIN_EMAIL=admin@nomanenobazaar.com
ADMIN_USERNAME=admin
```

### Image Host Authentication Notes

The image host service now uses session-based authentication with cookies instead of API keys:

- **IMAGE_HOST_API_URL**: Base URL for your image host API
- **IMAGE_HOST_LOGIN_URL**: Login endpoint (defaults to `{IMAGE_HOST_API_URL}/login`)
- **IMAGE_HOST_USERNAME**: Your image host account username
- **IMAGE_HOST_PASSWORD**: Your image host account password
- **IMAGE_HOST_UPLOAD_PRESET**: Optional upload preset name
- **IMAGE_HOST_FOLDER**: Optional folder name for uploads
- **IMAGE_HOST_SESSION_REFRESH**: Session refresh interval in minutes (default: 45, set to 0 to disable)

The service will automatically:

1. Login on startup to get a session cookie
2. Refresh the session periodically before expiry
3. Re-authenticate automatically on 401 errors

## Database Setup

### Option 1: Using Docker Compose (Recommended)

1. Make sure Docker is installed and running
2. Run: `docker-compose up -d postgres`
3. This will start PostgreSQL on port 5432

### Option 2: Local PostgreSQL

1. Install PostgreSQL 15
2. Create a database named `nomaneno_bazaar`
3. Create a user with username `nomaneno` and password `nomaneno123`
4. Update DATABASE_URL in .env if needed

## Running the Backend

1. Install dependencies (already done): `npm install`
2. Generate Prisma client: `npx prisma generate`
3. Run migrations: `npx prisma migrate dev --name init`
4. Seed the database: `npx prisma db seed`
5. Start the server: `npm run dev`

The API will be available at `http://localhost:5000/api`

## Initial Admin Account

After seeding, you can log in with:

- Email: admin@nomanenobazaar.com
- Password: admin123

**Important:** Change this password immediately after first login!
