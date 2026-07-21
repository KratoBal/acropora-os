-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'UPLOADED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "InventoryCountLineSyncStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
    "startedById" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expectedQty" DECIMAL(19,6) NOT NULL,
    "countedQty" DECIMAL(19,6),
    "syncStatus" "InventoryCountLineSyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_countNumber_key" ON "InventoryCount"("countNumber");

-- CreateIndex
CREATE INDEX "InventoryCount_status_createdAt_idx" ON "InventoryCount"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryCountLine_inventoryCountId_idx" ON "InventoryCountLine"("inventoryCountId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountLine_inventoryCountId_variantId_key" ON "InventoryCountLine"("inventoryCountId", "variantId");

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
