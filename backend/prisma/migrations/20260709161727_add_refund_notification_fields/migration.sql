-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "awaitingRefundAt" TIMESTAMP(3),
ADD COLUMN     "refundNotificationSent" BOOLEAN NOT NULL DEFAULT false;
