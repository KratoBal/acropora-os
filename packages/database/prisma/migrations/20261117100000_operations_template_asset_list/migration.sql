-- Üzemeltetési sablon: a cél lehet kézzel választott ESZKÖZLISTA is (task t-20261117-sablon-eszkozlista, kártya 42bc1c67; Balázs, 2026-11-17).
--
-- A régi állapot: a sablonnak volt egy `assetId` oszlopa (egy eszköz) VAGY egy `assetCategoryId` (egy kategória), a CHECK szerint
-- pontosan az egyik. Az új: a kategória (`assetCategoryId`) VAGY az `OperationsTaskTemplateAsset` kapcsolótábla sorai (legalább egy eszköz).
-- Az `assetId` oszlop megszűnik: a meglévő egy-eszközös sablonok egy elemű listává alakulnak (a bejegyzések és a sablon azonosítója
-- nem változik, tehát a régi bejegyzések olvashatók maradnak).
--
-- A SORREND SZÁMÍT: előbb létrejön a tábla, UTÁNA töltődik az adat, az ELLENŐRZÉS megáll, ha egy sor elveszett, és csak ezután esik el a
-- régi oszlop. A kategória XOR nem üres lista invariánst táblák közti CHECK nem fejezi ki: a szolgáltatás tartja (lásd a sémát).

-- CreateTable
CREATE TABLE "OperationsTaskTemplateAsset" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsTaskTemplateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationsTaskTemplateAsset_assetId_idx" ON "OperationsTaskTemplateAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationsTaskTemplateAsset_templateId_assetId_key" ON "OperationsTaskTemplateAsset"("templateId", "assetId");

-- AddForeignKey
ALTER TABLE "OperationsTaskTemplateAsset" ADD CONSTRAINT "OperationsTaskTemplateAsset_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OperationsTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsTaskTemplateAsset" ADD CONSTRAINT "OperationsTaskTemplateAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A MEGLÉVŐ EGY-ESZKÖZÖS SABLONOK ÁTVEZETÉSE: minden `assetId`-s sablonból egy sor (a `gen_random_uuid()` a PostgreSQL 13 óta beépített)
INSERT INTO "OperationsTaskTemplateAsset" ("id", "templateId", "assetId")
SELECT gen_random_uuid()::text, "id", "assetId"
FROM "OperationsTaskTemplate"
WHERE "assetId" IS NOT NULL;

-- AZ ÁTVEZETÉS ELLENŐRZÉSE: ha bármelyik sablon eszköz-kötése nem került át, a migráció MEGÁLL, és az `assetId` oszlop épen marad
DO $$
DECLARE
  expected integer;
  migrated integer;
BEGIN
  SELECT count(*) INTO expected FROM "OperationsTaskTemplate" WHERE "assetId" IS NOT NULL;
  SELECT count(*) INTO migrated
  FROM "OperationsTaskTemplateAsset" a
  JOIN "OperationsTaskTemplate" t ON t."id" = a."templateId" AND t."assetId" = a."assetId";
  IF expected <> migrated THEN
    RAISE EXCEPTION 'operations template asset list: % single-asset templates, % migrated: refusing to drop "assetId"', expected, migrated;
  END IF;
END $$;

-- DropCheck: a kettő közül pontosan egy cél a régi szabály volt; az új szabály (kategória XOR nem üres lista) a szolgáltatásban áll
ALTER TABLE "OperationsTaskTemplate" DROP CONSTRAINT "OperationsTaskTemplate_one_target";

-- DropForeignKey
ALTER TABLE "OperationsTaskTemplate" DROP CONSTRAINT "OperationsTaskTemplate_assetId_fkey";

-- DropIndex
DROP INDEX "OperationsTaskTemplate_assetId_idx";

-- AlterTable
ALTER TABLE "OperationsTaskTemplate" DROP COLUMN "assetId";
