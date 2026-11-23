-- The POS "Belső felhasználás" (card ec51e614, Balázs 2026-11-20): products taken off the shelf for our own use. Not a sale:
-- its own record, no SalesOrder, so no revenue summary ever sees it; the stock goes through the same movement writer.
-- Additive only: two enum values and two new tables.
-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'INTERNAL_USE';

-- AlterEnum
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'POS_INTERNAL_USE';

-- CreateTable
CREATE TABLE "PosInternalUse" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "totalCost" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosInternalUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosInternalUseLine" (
    "id" TEXT NOT NULL,
    "internalUseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(19,4),

    CONSTRAINT "PosInternalUseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosInternalUse_number_key" ON "PosInternalUse"("number");

-- CreateIndex
CREATE INDEX "PosInternalUse_occurredAt_idx" ON "PosInternalUse"("occurredAt");

-- CreateIndex
CREATE INDEX "PosInternalUse_performedById_idx" ON "PosInternalUse"("performedById");

-- CreateIndex
CREATE INDEX "PosInternalUseLine_internalUseId_idx" ON "PosInternalUseLine"("internalUseId");

-- CreateIndex
CREATE INDEX "PosInternalUseLine_variantId_idx" ON "PosInternalUseLine"("variantId");

-- AddForeignKey
ALTER TABLE "PosInternalUse" ADD CONSTRAINT "PosInternalUse_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosInternalUse" ADD CONSTRAINT "PosInternalUse_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosInternalUseLine" ADD CONSTRAINT "PosInternalUseLine_internalUseId_fkey" FOREIGN KEY ("internalUseId") REFERENCES "PosInternalUse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosInternalUseLine" ADD CONSTRAINT "PosInternalUseLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

