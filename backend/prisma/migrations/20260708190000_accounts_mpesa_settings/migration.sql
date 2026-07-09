-- User profile and email verification
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileImage" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailVerifyToken_key" ON "User"("emailVerifyToken");
UPDATE "User" SET "emailVerified" = true WHERE "emailVerified" = false;

-- Shared live site settings for admin-published changes
CREATE TABLE IF NOT EXISTS "SiteSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- M-Pesa STK push tracking
CREATE TABLE IF NOT EXISTS "MpesaPayment" (
  "id" TEXT NOT NULL,
  "checkoutRequestId" TEXT NOT NULL,
  "merchantRequestId" TEXT,
  "orderNumber" TEXT,
  "phone" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resultCode" INTEGER,
  "resultDesc" TEXT,
  "receiptNumber" TEXT,
  "rawCallback" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MpesaPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MpesaPayment_checkoutRequestId_key" ON "MpesaPayment"("checkoutRequestId");
