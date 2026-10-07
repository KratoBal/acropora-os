-- SEO P0 PR 4: GTIN (terv: exchange/seo/seo-pr4-terv-2026-10-07.md, D1-D4).
--
-- A ProductBarcode tipust, forrast es bizonyitekot kap. A DDL betura az, amit a
-- `prisma migrate diff` a main semajabol ide ir, plusz a reszleges egyedi index:
-- valtozatonkent legfeljebb EGY primary. A stage-en merve 2026-10-07 18:16:
-- 763 sor, mind primary, tobb primary-s valtozat 0, tehat az index nem bukik.
--
-- A `type` es a `source` NULL-ozhato: a mai sorokat a backfill CLI tolti ki
-- (`barcode-type-backfill.cli.ts`), mert a tipust a JEV `validateGtin` donti el
-- (hossz, ellenorzo szamjegy, bolti tartomany), es egy SQL-masolat elcsuszna tole.
--
-- Az enum uj erteke (`VARIANT_BARCODE`) ugyanabban a tranzakcioban nem hasznalhato,
-- ezert a definicio atallitasa kulon migracio (20261007200100).

-- CreateEnum
CREATE TYPE "ProductBarcodeType" AS ENUM ('EAN13', 'EAN8', 'UPCA', 'GTIN14', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ProductBarcodeSource" AS ENUM ('UNAS', 'IMPORT', 'MANUAL', 'JEV', 'POS');

-- AlterEnum
ALTER TYPE "AttributeMedusaNativeField" ADD VALUE 'VARIANT_BARCODE';

-- AlterTable
ALTER TABLE "ProductBarcode" ADD COLUMN     "fieldResultId" TEXT,
ADD COLUMN     "source" "ProductBarcodeSource",
ADD COLUMN     "type" "ProductBarcodeType",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateIndex
CREATE INDEX "ProductBarcode_fieldResultId_idx" ON "ProductBarcode"("fieldResultId");

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_fieldResultId_fkey" FOREIGN KEY ("fieldResultId") REFERENCES "ProductEnrichmentFieldResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex (reszleges, a Prisma semaban nem leirhato)
CREATE UNIQUE INDEX "ProductBarcode_variantId_primary_key" ON "ProductBarcode"("variantId") WHERE "isPrimary";
