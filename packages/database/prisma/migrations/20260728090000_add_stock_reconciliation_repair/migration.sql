-- CreateEnum: két repair-típus (A: LOCAL_FROM_PROVEN_LEDGER, B:
-- REPUBLISH_LOCAL_TO_UNAS) - lásd a schema.prisma-beli doc-commentet a
-- StockReconciliationRepairType enum felett a kihagyott "C" (kontrollált
-- baseline) típus indoklásáért.
CREATE TYPE "StockReconciliationRepairType" AS ENUM ('LOCAL_FROM_PROVEN_LEDGER', 'REPUBLISH_LOCAL_TO_UNAS');

-- CreateEnum
CREATE TYPE "StockReconciliationRepairStatus" AS ENUM ('APPLIED', 'NOOP', 'REJECTED');

-- CreateTable: auditálható, egyedi rekordokra korlátozott admin-repair
-- napló - lásd a schema.prisma-beli doc-commentet a
-- StockReconciliationRepair modell felett és
-- docs/INVENTORY-CONSISTENCY.md "Biztonságos javítási terv".
CREATE TABLE "StockReconciliationRepair" (
    "id" TEXT NOT NULL,
    "repairType" "StockReconciliationRepairType" NOT NULL,
    "status" "StockReconciliationRepairStatus" NOT NULL,
    "stockItemId" TEXT,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expectedCurrentOnHand" DECIMAL(19,6) NOT NULL,
    "beforeOnHand" DECIMAL(19,6),
    "afterOnHand" DECIMAL(19,6),
    "ledgerExpectedOnHand" DECIMAL(19,6),
    "movementId" TEXT,
    "outboxId" TEXT,
    "requestDetail" JSONB,
    "resultDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StockReconciliationRepair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockReconciliationRepair_idempotencyKey_key" ON "StockReconciliationRepair"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockReconciliationRepair_variantId_warehouseId_idx" ON "StockReconciliationRepair"("variantId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockReconciliationRepair_status_createdAt_idx" ON "StockReconciliationRepair"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StockReconciliationRepair_actorUserId_createdAt_idx" ON "StockReconciliationRepair"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockReconciliationRepair" ADD CONSTRAINT "StockReconciliationRepair_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReconciliationRepair" ADD CONSTRAINT "StockReconciliationRepair_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReconciliationRepair" ADD CONSTRAINT "StockReconciliationRepair_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReconciliationRepair" ADD CONSTRAINT "StockReconciliationRepair_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
