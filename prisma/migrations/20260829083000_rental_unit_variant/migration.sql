-- AlterTable
ALTER TABLE "RentalUnit" ADD COLUMN "variantId" TEXT;
ALTER TABLE "RentalUnit" ADD COLUMN "variantTitle" TEXT;

-- Backfill existing rows so the new unique key can be applied.
-- Re-import / sync from Shopify to attach real variant GIDs.
UPDATE "RentalUnit"
SET "variantId" = 'legacy:' || "id"
WHERE "variantId" IS NULL OR "variantId" = '';

ALTER TABLE "RentalUnit" ALTER COLUMN "variantId" SET NOT NULL;

-- DropIndex
DROP INDEX "RentalUnit_shopId_productId_size_color_key";

-- CreateIndex
CREATE UNIQUE INDEX "RentalUnit_shopId_productId_variantId_key" ON "RentalUnit"("shopId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "RentalUnit_shopId_variantId_idx" ON "RentalUnit"("shopId", "variantId");
