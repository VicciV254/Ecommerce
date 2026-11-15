-- Phase 6: Cloudinary-hosted media metadata and optional variant-specific images.
-- One Cloudinary asset may back several image rows (shared placeholders/placements), so its public ID is no longer unique.
-- The asset version is kept only in the delivery URL; Cloudinary versions are Unix timestamps and would overflow INTEGER in 2038.

-- DropIndex
DROP INDEX "ProductImage_cloudinaryPublicId_key";

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "bytes" INTEGER,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "variantId" TEXT;

-- CreateIndex
CREATE INDEX "ProductImage_cloudinaryPublicId_idx" ON "ProductImage"("cloudinaryPublicId");

-- CreateIndex
CREATE INDEX "ProductImage_variantId_idx" ON "ProductImage"("variantId");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_cloudinary_fields_check" CHECK (
  ("cloudinaryPublicId" IS NULL OR "format" IS NOT NULL)
  AND ("bytes" IS NULL OR "bytes" > 0)
);

-- Only product images can show a specific variant; standalone storefront media cannot.
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_variant_owner_check" CHECK (
  "variantId" IS NULL OR "productId" IS NOT NULL
);
