-- Preserve UNAS order lines as immutable audit history when a later order
-- payload no longer contains them. Active list/detail counts filter on NULL.
ALTER TABLE "SalesOrderLine"
  ADD COLUMN "unasRemovedAt" TIMESTAMP(3);

CREATE INDEX "SalesOrderLine_orderId_unasRemovedAt_idx"
  ON "SalesOrderLine"("orderId", "unasRemovedAt");
