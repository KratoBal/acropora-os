-- Variant combinations are materialized by the first full UNAS product
-- sync after deployment. This migration is deliberately metadata-only:
-- assigning an existing aggregate StockItem to an arbitrary first
-- combination would corrupt inventory semantics.
ALTER TABLE "ProductVariant"
  ADD COLUMN "unasBaseSku" TEXT,
  ADD COLUMN "unasVariantKey" TEXT,
  ADD COLUMN "unasVariantValues" JSONB,
  ADD COLUMN "unasReportedStock" DECIMAL(19,6),
  ADD COLUMN "unasReportedStockSyncedAt" TIMESTAMP(3);

CREATE INDEX "ProductVariant_unasBaseSku_idx"
  ON "ProductVariant"("unasBaseSku");

CREATE UNIQUE INDEX "ProductVariant_productId_unasVariantKey_key"
  ON "ProductVariant"("productId", "unasVariantKey");
