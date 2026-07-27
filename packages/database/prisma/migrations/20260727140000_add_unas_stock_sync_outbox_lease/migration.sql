-- AlterTable: PROCESSING-lease az outbox worker összeomlásbiztos claim
-- mechanizmusához (SELECT ... FOR UPDATE SKIP LOCKED + lease timeout) -
-- lásd apps/api/src/inventory/unas-stock-sync-outbox.repository.ts és
-- docs/architecture/inventory-consistency.md.
ALTER TABLE "UnasStockSyncOutbox"
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "claimedBy" TEXT;

-- CreateIndex
CREATE INDEX "UnasStockSyncOutbox_status_leaseExpiresAt_idx" ON "UnasStockSyncOutbox"("status", "leaseExpiresAt");
