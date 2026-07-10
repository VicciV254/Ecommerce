-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_REFUND';

-- AlterTable
ALTER TABLE "MpesaPayment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "autoStageEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoStageLastUpdate" TIMESTAMP(3),
ADD COLUMN     "autoStagePaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "refundApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SiteSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_email_key" ON "Subscription"("email");
