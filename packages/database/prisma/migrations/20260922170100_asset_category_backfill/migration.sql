-- A meglévő eszközök átvezetése a kategória-törzsadatra.
--
-- === EZ AZ A LÉPÉS, AMI MEGLÉVŐ SORT ÍR ===
--
-- Külön migráció, szándékosan: az előző csak hozzáadott (tábla, oszlop, hat
-- új sor), ez viszont MÁR MEGLÉVŐ `Asset` sorokat frissít. A kettő így külön
-- megítélhető, és az élesítéshez külön engedély kérhető.
--
-- === MIT CSINÁL, ÉS MIT NEM ===
--
-- A szöveges `category` értékből tölti a `categoryId` hivatkozást, NÉV SZERINT
-- egyeztetve. Ami NEM illeszkedik egyetlen kategóriára sem, az `NULL` marad --
-- NEM hozunk létre neki kategóriát.
--
-- AZ INDOK: egy automatikusan felvett kategória pont azt hozná vissza, ami
-- miatt ez a tábla létrejött. Az elgépelt értékeket (`VÍzkezelés`,
-- `Kízekezelés`, `Segédeszkőz`, `Ventúri`) Balázs engedélyével már kijavítottuk
-- a szöveges mezőben, tehát ha maradt ilyen, az a javítás ÓTA keletkezett --
-- és akkor emberi döntés kell hozzá, nem egy csendes új sor.
--
-- A `category` szöveges oszlop MEGMARAD: amíg ott áll, ez a migráció
-- eredménye ellenőrizhető (a szöveg és a hivatkozott név összevethető). Az
-- eldobása külön, visszafordíthatatlan lépés.
--
-- ELLENŐRZÉS A FUTTATÁS UTÁN (nem a migráció része, mert állítást tenne egy
-- darabszámról, ami addigra már más):
--
--   SELECT a."category", COUNT(*)
--   FROM "Asset" a
--   WHERE a."category" IS NOT NULL AND a."categoryId" IS NULL
--   GROUP BY 1;
--
-- Ha ez üres, minden szöveges érték talált kategóriát.
UPDATE "Asset" a
SET "categoryId" = c."id"
FROM "AssetCategory" c
WHERE a."category" IS NOT NULL
  AND a."categoryId" IS NULL
  AND a."category" = c."name";
