-- DropForeignKey
ALTER TABLE "ProductImage" DROP CONSTRAINT "ProductImage_productId_fkey";

-- DropForeignKey
ALTER TABLE "Stock" DROP CONSTRAINT "Stock_productId_fkey";

-- DropIndex
DROP INDEX "Category_name_key";

-- DropIndex
DROP INDEX "Stock_productId_key";

-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedValue" JSONB,
ADD COLUMN     "publishedVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "variantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "collection" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specifications" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "isActive" SET DEFAULT false;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "attributeKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentId" TEXT,
ALTER COLUMN "order" SET NOT NULL,
ALTER COLUMN "order" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Designer" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "cloudinaryPublicId" TEXT,
ADD COLUMN     "credit" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "license" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "width" INTEGER,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Stock" DROP COLUMN "productId",
ADD COLUMN     "variantId" TEXT NOT NULL,
ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'OUT_OF_STOCK';

-- AlterTable
ALTER TABLE "Discount" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "sku" TEXT,
ADD COLUMN     "variantAttributes" JSONB,
ADD COLUMN     "variantId" TEXT;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "price" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_userId_productId_key" ON "Wishlist"("userId", "productId");

-- CreateIndex
CREATE INDEX "Category_parentId_order_idx" ON "Category"("parentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_cloudinaryPublicId_key" ON "ProductImage"("cloudinaryPublicId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_variantId_key" ON "Stock"("variantId");

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Initialize the new public identity once; legacy settings are not imported.
INSERT INTO "SiteSetting" ("key", "value", "publishedValue", "version", "publishedVersion", "publishedAt", "createdAt", "updatedAt")
VALUES ('storefront-v2', '{"brand":{"name":"Apex Cart","tagline":"","logoMediaId":null,"faviconMediaId":null},"theme":{"fontId":"default","colors":{"primary":"#14213d","secondary":"#d4a73c","accent":"#926d21","warmBeige":"#f4f1e9","oceanBlue":"#1d4e89","oceanBlueDark":"#173f6e","coral":"#b75238","success":"#237a4b","warning":"#9a6700","error":"#b42318","charcoal":"#253044","offWhite":"#f8fafc","lightGray":"#d8dee7","lightPink":"#eef2f7"}},"sections":[{"id":"departments","type":"departments","title":"Shop by department","enabled":true,"productIds":[],"categoryIds":[],"campaignId":null},{"id":"featured","type":"featured","title":"Featured products","enabled":true,"productIds":[],"categoryIds":[],"campaignId":null}],"campaigns":[]}'::jsonb, '{"brand":{"name":"Apex Cart","tagline":"","logoMediaId":null,"faviconMediaId":null},"theme":{"fontId":"default","colors":{"primary":"#14213d","secondary":"#d4a73c","accent":"#926d21","warmBeige":"#f4f1e9","oceanBlue":"#1d4e89","oceanBlueDark":"#173f6e","coral":"#b75238","success":"#237a4b","warning":"#9a6700","error":"#b42318","charcoal":"#253044","offWhite":"#f8fafc","lightGray":"#d8dee7","lightPink":"#eef2f7"}},"sections":[{"id":"departments","type":"departments","title":"Shop by department","enabled":true,"productIds":[],"categoryIds":[],"campaignId":null},{"id":"featured","type":"featured","title":"Featured products","enabled":true,"productIds":[],"categoryIds":[],"campaignId":null}],"campaigns":[]}'::jsonb, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
