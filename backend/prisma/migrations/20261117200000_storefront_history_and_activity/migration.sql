-- Publication history: every published storefront document, with when and by whom, so staff can restore one into the
-- draft. Staff activity entries gain the record they are about, and indexes for the newest-first list and its filters.

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetType" TEXT;

-- CreateTable
CREATE TABLE "StorefrontRevision" (
    "id" TEXT NOT NULL,
    "settingKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontRevision_settingKey_version_key" ON "StorefrontRevision"("settingKey", "version");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "StorefrontRevision" ADD CONSTRAINT "StorefrontRevision_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The history starts with the storefront that is live now. Nobody recorded who published it, so its publisher is null.
INSERT INTO "StorefrontRevision" ("id", "settingKey", "version", "value", "publishedAt", "publishedById")
SELECT gen_random_uuid()::text, "key", "publishedVersion", "publishedValue", COALESCE("publishedAt", "updatedAt"), NULL
FROM "SiteSetting"
WHERE "key" = 'storefront-v2' AND "publishedValue" IS NOT NULL AND "publishedVersion" > 0;
