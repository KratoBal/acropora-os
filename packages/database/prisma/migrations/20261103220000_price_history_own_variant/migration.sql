-- Own-price history per variant (T4.1-D2). Additive: a new enum value, a nullable column, an index and a foreign key; no existing row changes, and no existing index (the partial INITIAL one included) is touched.
-- ROLLBACK: DROP INDEX "ProductPriceHistory_variantId_observedAt_idx"; ALTER TABLE "ProductPriceHistory" DROP CONSTRAINT "ProductPriceHistory_variantId_fkey"; ALTER TABLE "ProductPriceHistory" DROP COLUMN "variantId"; the enum value stays (Postgres cannot drop one); delete the OWN rows first if the rollback must also remove them.
ALTER TYPE "PriceHistorySource" ADD VALUE 'OWN';

ALTER TABLE "ProductPriceHistory" ADD COLUMN "variantId" TEXT;

CREATE INDEX "ProductPriceHistory_variantId_observedAt_idx"
    ON "ProductPriceHistory"("variantId", "observedAt");

ALTER TABLE "ProductPriceHistory"
    ADD CONSTRAINT "ProductPriceHistory_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
