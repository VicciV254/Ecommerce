BEGIN;

-- Unlinked legacy records remain untouched and cannot settle a new order.
-- AlterTable
ALTER TABLE "MpesaPayment" ADD COLUMN     "callbackKeyHash" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "environment" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "merchantIdentity" TEXT,
ADD COLUMN     "merchantShortcode" TEXT,
ADD COLUMN     "nextReconcileAt" TIMESTAMP(3),
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "providerVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "queryEvidence" JSONB,
ADD COLUMN     "reconcileCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reconcileLease" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "reviewCode" TEXT,
ALTER COLUMN "checkoutRequestId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'INITIATING';

-- CreateTable
CREATE TABLE "MpesaPaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MpesaPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MpesaPaymentEvent_paymentId_createdAt_idx" ON "MpesaPaymentEvent"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaPaymentEvent_paymentId_fingerprint_key" ON "MpesaPaymentEvent"("paymentId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaPayment_reference_key" ON "MpesaPayment"("reference");

-- CreateIndex
CREATE INDEX "MpesaPayment_status_nextReconcileAt_idx" ON "MpesaPayment"("status", "nextReconcileAt");

-- CreateIndex
CREATE INDEX "MpesaPayment_orderId_createdAt_idx" ON "MpesaPayment"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaPayment_orderId_idempotencyKey_key" ON "MpesaPayment"("orderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaPayment_environment_receiptNumber_key" ON "MpesaPayment"("environment", "receiptNumber");

-- AddForeignKey
ALTER TABLE "MpesaPayment" ADD CONSTRAINT "MpesaPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaPaymentEvent" ADD CONSTRAINT "MpesaPaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MpesaPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MpesaPayment" ADD CONSTRAINT "MpesaPayment_linked_attempt_fields" CHECK (
  "orderId" IS NULL OR (
    "environment" IS NOT NULL AND "environment" IN ('sandbox', 'production')
    AND "idempotencyKey" IS NOT NULL AND "requestHash" IS NOT NULL
    AND "merchantIdentity" IS NOT NULL AND "merchantShortcode" IS NOT NULL
    AND "callbackKeyHash" IS NOT NULL AND "reference" IS NOT NULL
    AND "status" IN ('INITIATING', 'PENDING', 'UNKNOWN', 'REVIEW', 'SUCCEEDED', 'FAILED')
    AND "amount" > 0 AND "amount" = trunc("amount")
  )
);

COMMIT;
