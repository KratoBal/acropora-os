-- Az eszköz kategóriája: saját törzsadat.
--
-- Balázs kérése, 2026-09-22: „az eszkozfelvitelniel a kategoria legyen
-- legordulomenu".
--
-- === EZ A MIGRÁCIÓ MEGLÉVŐ SORT NEM ÍR ===
--
-- Két lépést végez, és mindkettő HOZZÁAD:
--   1. létrehozza a táblát és az `Asset.categoryId` oszlopot (üresen),
--   2. feltölti a hat valódi kategóriát.
--
-- A meglévő eszközök ÁTVEZETÉSE külön migrációban áll
-- (`20260922170100_asset_category_backfill`), mert az MÁR meglévő sorokat ír.
-- A kettő szándékosan van szétválasztva: így az élesítéshez két külön,
-- külön megítélhető engedély kérhető, és a másodikat könnyebb megadni, ha az
-- első már áll és látható.
--
-- === A HAT ÉRTÉK MÉRÉSBŐL JÖN, NEM TALÁLGATÁSBÓL ===
--
-- Az éles adatban tíz különböző kategória-szöveg állt, de csak hat valódi; a
-- másik négy elgépelés volt, és azokat Balázs engedélyével már kijavítottuk.
-- A sorrend a gyakoriságot követi: a két első együtt adja a sorok többségét,
-- és egy betűrendes lista közéjük szórná őket.
--
-- DARABSZÁMOT EZ A KOMMENT SZÁNDÉKOSAN NEM ÁLLÍT: az eszközök száma a mérés
-- óta is nőtt (110-ről 124-re, tíz perc alatt), tehát bármilyen szám itt a
-- futtatás pillanatában már hamis lenne.
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetCategory_name_key" ON "AssetCategory"("name");
CREATE INDEX "AssetCategory_isActive_sortOrder_idx" ON "AssetCategory"("isActive", "sortOrder");

ALTER TABLE "Asset" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- `Restrict`, ugyanúgy, mint a mértékegységnél: egy kategória, amire eszköz
-- mutat, nem törölhető ki alóla. A kivezetés `isActive`-kal megy.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A hat valódi érték. `gen_random_uuid()` a `pgcrypto`/`pg_catalog` beépített
-- függvénye (PostgreSQL 13 óta a core-ban), tehát nem igényel kiterjesztést.
INSERT INTO "AssetCategory" ("id", "name", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Vízkezelés',  10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Vízmozgatás', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Segédeszköz', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Szűrés',      40, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Világítás',   50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Venturi',     60, CURRENT_TIMESTAMP);
