-- A Foxpost settlement row whose reference is a Medusa (webshop) order number.
-- The parcel we create for a webshop order carries the order's display id as its
-- reference, so the monthly settlement reader resolves it through WebshopParcel
-- to the webshop order and its invoice. The order is not stored in this database,
-- so the link is a plain column, not a foreign key.
-- Additive: one enum value, one nullable column, one index. No existing row changes.
-- ROLLBACK: DROP INDEX "FoxpostSettlementLine_webshopOrderId_idx";
--           ALTER TABLE "FoxpostSettlementLine" DROP COLUMN "webshopOrderId";
--           (an enum value cannot be dropped: rows with WEBSHOP must be re-resolved first)

-- AddEnumValue
ALTER TYPE "FoxpostResolutionSource" ADD VALUE 'WEBSHOP';

-- AlterTable
ALTER TABLE "FoxpostSettlementLine" ADD COLUMN "webshopOrderId" VARCHAR(64);

-- CreateIndex
CREATE INDEX "FoxpostSettlementLine_webshopOrderId_idx" ON "FoxpostSettlementLine"("webshopOrderId");
