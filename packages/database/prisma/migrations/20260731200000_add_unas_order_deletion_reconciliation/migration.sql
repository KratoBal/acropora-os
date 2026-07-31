-- UNAS-ból fizikailag törölt rendelések felismerése és a hozzájuk tartozó
-- készlet-visszaforgatás - lásd docs/INVENTORY-CONSISTENCY.md "UNAS-ból
-- fizikailag törölt rendelések" és SalesOrder.unasDeletedAt doc-comment.
--
-- ALTER TYPE ... ADD VALUE Postgres-ben csak akkor futtatható biztonságosan
-- ugyanabban a tranzakcióban, mint ami hozzáadja, ha az új értéket a
-- migráció nem használja fel DML-ben is - itt nem használja.
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'UNAS_ORDER_DELETED';

-- AlterTable
ALTER TABLE "SalesOrder"
  ADD COLUMN "unasDeletedAt" TIMESTAMP(3),
  ADD COLUMN "unasExistenceCheckDueAt" TIMESTAMP(3),
  ADD COLUMN "unasExistenceCheckLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "unasExistenceCheckClaimedBy" TEXT,
  ADD COLUMN "unasExistenceCheckAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SalesOrder_channel_unasDeletedAt_unasExistenceCheckDueAt_idx"
  ON "SalesOrder"("channel", "unasDeletedAt", "unasExistenceCheckDueAt");
