-- CreateEnum
CREATE TYPE "UnasStockSyncOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "UnasStockSyncSourceProcess" AS ENUM ('INVENTORY_COUNT', 'PURCHASE_INVOICE', 'POS_SALE', 'UNAS_ORDER_IMPORT', 'UNAS_ORDER_UPDATE', 'UNAS_ORDER_CANCEL', 'RECONCILIATION');

-- AlterTable: idempotenciakulcs a StockMovement-en - lásd a
-- schema.prisma-beli doc-commentet a StockMovement modell felett. Nullable,
-- hogy a bevezetés előtti meglévő sorokat ne érintse.
ALTER TABLE "StockMovement" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");

-- CreateTable: tartós, tranzakciós outbox a UNAS-készletpublikáláshoz -
-- lásd a schema.prisma-beli doc-commentet a UnasStockSyncOutbox modell
-- felett és docs/architecture/inventory-consistency.md.
CREATE TABLE "UnasStockSyncOutbox" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "targetOnHand" DECIMAL(19,6) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceProcess" "UnasStockSyncSourceProcess" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "status" "UnasStockSyncOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "resolutionNote" TEXT,
    "sequence" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "UnasStockSyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnasStockSyncOutbox_idempotencyKey_key" ON "UnasStockSyncOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UnasStockSyncOutbox_status_nextAttemptAt_idx" ON "UnasStockSyncOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "UnasStockSyncOutbox_variantId_warehouseId_status_idx" ON "UnasStockSyncOutbox"("variantId", "warehouseId", "status");

-- CreateIndex
CREATE INDEX "UnasStockSyncOutbox_sourceProcess_sourceRecordId_idx" ON "UnasStockSyncOutbox"("sourceProcess", "sourceRecordId");

-- AddForeignKey
ALTER TABLE "UnasStockSyncOutbox" ADD CONSTRAINT "UnasStockSyncOutbox_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnasStockSyncOutbox" ADD CONSTRAINT "UnasStockSyncOutbox_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
