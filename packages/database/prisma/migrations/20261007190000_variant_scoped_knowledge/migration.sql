-- SEO P0 PR 3: a ProductKnowledgeFact valtozat-szintu is lehet.
--
-- `variantId` NULL = termekszintu teny (minden mai sor ilyen: a stage-en 8 sor,
-- elesen 0, merve 2026-10-07 16:45), tehat adatmozgas es backfill nincs: a
-- `scopeKey` alapertelmezese ('') pont a mai sorokat irja le.
--
-- A `scopeKey` azert kell a `variantId` mellett, mert egy egyedi indexben a NULL
-- nem utkozik: `(productId, variantId, field)` ket termekszintu sort is engedne
-- ugyanarra a mezore. A CHECK koti a ketto egyezeset, hogy ne csuszhassanak el.
--
-- Az FK csak OS-valtozatot enged (cuid, 25 jel): Medusa-azonosito (34 jel) nem
-- kerulhet ide. Hogy a valtozat UGYANANNAK a termeknek a valtozata, azt az
-- elfogadas ellenorzi (`knowledge.service.ts`), nem a sema.

-- DropIndex
DROP INDEX "ProductKnowledgeFact_productId_field_key";

-- AlterTable
ALTER TABLE "ProductKnowledgeFact" ADD COLUMN     "scopeKey" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "variantId" TEXT;

ALTER TABLE "ProductKnowledgeFact" ADD CONSTRAINT "ProductKnowledgeFact_scopeKey_check"
  CHECK ("scopeKey" = coalesce("variantId", ''));

-- CreateIndex
CREATE INDEX "ProductKnowledgeFact_variantId_idx" ON "ProductKnowledgeFact"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductKnowledgeFact_productId_scopeKey_field_key" ON "ProductKnowledgeFact"("productId", "scopeKey", "field");

-- AddForeignKey
ALTER TABLE "ProductKnowledgeFact" ADD CONSTRAINT "ProductKnowledgeFact_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
