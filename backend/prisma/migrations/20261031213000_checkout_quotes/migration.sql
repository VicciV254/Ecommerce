-- One atomic statement preserves the original error for Prisma's migration ledger.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT amount::numeric AS amount FROM "MpesaPayment"
      UNION ALL SELECT subtotal::numeric FROM "Cart"
      UNION ALL SELECT discount::numeric FROM "Cart"
      UNION ALL SELECT total::numeric FROM "Cart"
      UNION ALL SELECT price::numeric FROM "CartItem"
      UNION ALL SELECT price::numeric FROM "Product"
      UNION ALL SELECT "compareAtPrice"::numeric FROM "Product"
      UNION ALL SELECT price::numeric FROM "ProductVariant"
      UNION ALL SELECT value::numeric FROM "Discount"
      UNION ALL SELECT subtotal::numeric FROM "Order"
      UNION ALL SELECT discount::numeric FROM "Order"
      UNION ALL SELECT tax::numeric FROM "Order"
      UNION ALL SELECT "shippingCost"::numeric FROM "Order"
      UNION ALL SELECT total::numeric FROM "Order"
      UNION ALL SELECT "productPrice"::numeric FROM "OrderItem"
      UNION ALL SELECT subtotal::numeric FROM "OrderItem"
    ) amounts
    WHERE amount < 0 OR amount >= 1000000000000 OR amount <> round(amount, 2)
  ) THEN
    RAISE EXCEPTION 'Existing money needs review before conversion: supported amounts are nonnegative, below 1 trillion KES, and at most two decimal places';
  END IF;

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('COMMITTED', 'HELD', 'RELEASED', 'EXPIRED');

-- AlterTable
ALTER TABLE "MpesaPayment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Cart" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CartItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "compareAtPrice" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "ProductVariant" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "reserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_reservation_bounds" CHECK (
  "quantity" >= 0 AND "quantity" <= 1000000 AND "reserved" >= 0 AND "reserved" <= "quantity"
);

-- AlterTable
ALTER TABLE "Discount" ADD COLUMN     "couponCode" TEXT,
ALTER COLUMN "value" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "addressSnapshot" JSONB,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "reservationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "reservationStatus" "ReservationStatus" NOT NULL DEFAULT 'COMMITTED',
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "tax" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "shippingCost" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(14,2);

UPDATE "Order" AS orders
SET "addressSnapshot" = jsonb_build_object(
  'id', addresses.id, 'street', addresses.street, 'city', addresses.city,
  'county', addresses.county, 'postalCode', addresses."postalCode"
)
FROM "Address" AS addresses
WHERE orders."addressId" = addresses.id AND orders."addressSnapshot" IS NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "pricingSnapshot" JSONB,
ALTER COLUMN "productPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2);

-- CreateTable
CREATE TABLE "CheckoutQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutQuote_userId_expiresAt_idx" ON "CheckoutQuote"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_couponCode_key" ON "Discount"("couponCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE INDEX "Order_reservationStatus_reservationExpiresAt_idx" ON "Order"("reservationStatus", "reservationExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CheckoutQuote" ADD CONSTRAINT "CheckoutQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

END;
$migration$;
