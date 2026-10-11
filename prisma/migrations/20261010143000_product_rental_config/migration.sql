-- CreateTable
CREATE TABLE "ProductRentalConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "productHandle" TEXT,
    "productImage" TEXT,
    "bookingType" TEXT NOT NULL DEFAULT 'single',
    "blockDates" JSONB NOT NULL,
    "calendarStartDays" INTEGER NOT NULL DEFAULT 15,
    "dayEndHour" INTEGER,
    "calendarEndDays" INTEGER NOT NULL DEFAULT 365,
    "weekdays" JSONB NOT NULL,
    "depositAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositPercent" INTEGER NOT NULL DEFAULT 70,
    "durationLabels" JSONB NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRentalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRentalConfig_shopId_productId_key" ON "ProductRentalConfig"("shopId", "productId");

-- CreateIndex
CREATE INDEX "ProductRentalConfig_shopId_active_idx" ON "ProductRentalConfig"("shopId", "active");

-- CreateIndex
CREATE INDEX "ProductRentalConfig_shopId_updatedAt_idx" ON "ProductRentalConfig"("shopId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ProductRentalConfig" ADD CONSTRAINT "ProductRentalConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
