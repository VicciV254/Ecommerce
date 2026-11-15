-- Phase 5 separates fulfilment from returns and refunds. Combined legacy states
-- cannot be mapped safely to refund records, so refuse rather than guess.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Order" WHERE "status"::text IN ('AWAITING_REFUND', 'RETURNED'))
    OR EXISTS (SELECT 1 FROM "TrackingEvent" WHERE "status"::text IN ('AWAITING_REFUND', 'RETURNED')) THEN
    RAISE EXCEPTION 'Orders or tracking events use AWAITING_REFUND/RETURNED; resolve them explicitly before this migration.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ReturnRule" AS ENUM ('STANDARD', 'FAULT_ONLY', 'UNOPENED_OR_FAULT');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('CHANGED_MIND', 'FAULTY', 'DAMAGED', 'WRONG_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'UNRESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundSource" AS ENUM ('CANCELLATION', 'RETURN', 'PAYMENT_REVIEW');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD');

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED');
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "TrackingEvent" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "returnRule" "ReturnRule";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "autoStageEnabled",
DROP COLUMN "autoStageLastUpdate",
DROP COLUMN "autoStagePaused",
DROP COLUMN "awaitingRefundAt",
DROP COLUMN "refundApproved",
DROP COLUMN "refundNotificationLastSentAt",
DROP COLUMN "refundNotificationSent",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "processingAt" TIMESTAMP(3),
ADD COLUMN     "readyForPickupAt" TIMESTAMP(3),
ADD COLUMN     "settledPaymentId" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingEvent" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorType" TEXT,
ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "comment" TEXT,
    "unopenedDeclared" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "merchantFaultConfirmed" BOOLEAN,
    "inspectionNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnRule" "ReturnRule" NOT NULL,
    "receivedQuantity" INTEGER,
    "restockQuantity" INTEGER,
    "refundableQuantity" INTEGER,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "returnRequestId" TEXT,
    "dedupeKey" TEXT,
    "source" "RefundSource" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(14,2) NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "includesDeliveryFee" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL DEFAULT 'MPESA_MANUAL',
    "reason" TEXT,
    "requestedByType" TEXT NOT NULL,
    "requestedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "processingAt" TIMESTAMP(3),
    "processingById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "providerReference" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "unresolvedAt" TIMESTAMP(3),
    "unresolvedNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "orderId" TEXT,
    "userId" TEXT,
    "returnRequestId" TEXT,
    "refundId" TEXT,
    "recipient" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAlertRead" (
    "adminId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAlertRead_pkey" PRIMARY KEY ("adminId","alertKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_number_key" ON "ReturnRequest"("number");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_createdAt_idx" ON "ReturnRequest"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_userId_idempotencyKey_key" ON "ReturnRequest"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ReturnLine_orderItemId_idx" ON "ReturnLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnLine_returnRequestId_orderItemId_key" ON "ReturnLine"("returnRequestId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_number_key" ON "Refund"("number");

-- CreateIndex
CREATE INDEX "Refund_returnRequestId_idx" ON "Refund"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_dedupeKey_key" ON "Refund"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerReference_key" ON "Refund"("providerReference");

-- CreateIndex
CREATE INDEX "Refund_orderId_createdAt_idx" ON "Refund"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_orderId_createdAt_idx" ON "Notification"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_paymentStatus_idx" ON "Order"("status", "paymentStatus");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MpesaPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAlertRead" ADD CONSTRAINT "StaffAlertRead_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remember the confirmed payment already attributed to each paid order.
UPDATE "Order" o SET "settledPaymentId" = (
  SELECT p."id" FROM "MpesaPayment" p
  WHERE p."orderId" = o."id" AND p."confirmedAt" IS NOT NULL AND p."amount" = o."total"
  ORDER BY p."confirmedAt" ASC, p."id" ASC LIMIT 1
) WHERE o."paymentStatus" = 'PAID' AND o."settledPaymentId" IS NULL;

-- Approved 2026-11-14 initial return rules; descendants inherit them.
UPDATE "Category" SET "returnRule" = 'FAULT_ONLY'
  WHERE "slug" IN ('dairy', 'underwear', 'lingerie-sleep-lounge');
UPDATE "Category" SET "returnRule" = 'UNOPENED_OR_FAULT'
  WHERE "slug" IN ('health-beauty', 'pacifiers-accessories', 'bottle-feeding', 'breastfeeding',
    'disposable-diapers', 'wipes-holders', 'cloth-diapers');
UPDATE "Category" SET "returnRule" = 'STANDARD' WHERE "slug" = 'hair-tools';

ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_quantities_check" CHECK (
  "quantity" > 0
  AND ("receivedQuantity" IS NULL OR ("receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity"))
  AND ("restockQuantity" IS NULL OR ("restockQuantity" >= 0 AND "restockQuantity" <= COALESCE("receivedQuantity", -1)))
  AND ("refundableQuantity" IS NULL OR ("refundableQuantity" >= 0 AND "refundableQuantity" <= COALESCE("receivedQuantity", -1)))
);

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_check" CHECK (
  "amount" > 0 AND "amount" = trunc("amount")
  AND "requestedAmount" > 0 AND "requestedAmount" = trunc("requestedAmount")
  AND "amount" <= "requestedAmount"
);

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_confirmation_check" CHECK (
  "status" <> 'CONFIRMED' OR ("providerReference" IS NOT NULL AND "confirmedAt" IS NOT NULL)
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_attempts_check" CHECK ("attempts" >= 0);
