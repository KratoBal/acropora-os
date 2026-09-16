-- A „nem üzemel" állapot helyére két tartalék-állapot lép.
--
-- A KÉRÉS: Balázs, 2026-09-16 14:22 (Discord, Acropora OS szal): "szerintem
-- kellene a nem uzemel helyett ket statusz: hideg tartalek, meleg tartalek".
-- Jóváhagyva ugyanott 14:27-kor.
--
-- MIÉRT TÍPUS-CSERE ÉS NEM `ALTER TYPE ... ADD VALUE`: egy érték KIKERÜL. A
-- Postgres enumból nem lehet értéket eldobni, tehát új típus készül, az oszlop
-- átáll rá, és a régi típus eltűnik. Ez az egyetlen út, amin az `OUT_OF_SERVICE`
-- ténylegesen megszűnik -- egy ottfelejtett érték később újra felbukkanna egy
-- legördülőben.
--
-- A SORREND ADAT: a lista állapot szerinti rendezése az enum DEKLARÁCIÓS
-- sorrendjéből dolgozik (`assetListOrderBy`), tehát a két új érték helye
-- megjelenik a felhasználónak. Csökkenő rendelkezésre állás: üzemel, azonnal
-- beállítható, tartalék, javítás alatt, kivezetve.

-- 1. AZ ÚJ TÍPUS.
CREATE TYPE "AssetStatus_new" AS ENUM (
  'ACTIVE',
  'WARM_STANDBY',
  'COLD_STANDBY',
  'IN_REPAIR',
  'RETIRED'
);

-- 2. AZ ALAPÉRTELMEZÉS ELŐSZÖR ESIK LE, ÉS EZ NEM ÓVATOSKODÁS: a `DEFAULT`
--    kifejezése a RÉGI típusra van típusozva, tehát alatta az oszlop típusa
--    nem változtatható meg. A végén visszakerül.
ALTER TABLE "Asset" ALTER COLUMN "status" DROP DEFAULT;

-- 3. AZ OSZLOP ÁTÁLLÁSA, A KIESŐ ÉRTÉK LEKÉPEZÉSÉVEL.
--
--    AZ ADAT-ÁG VÁRHATÓAN NULLA SORT ÉRINT, és a forrása pontosan ennyi:
--    Balázs 2026-09-16 14:34-kor kimondta (Discord), hogy „nincs most nem
--    uzemel-ben semmi". EZ AZ Ő ÁLLÍTÁSA, nem egy lekérdezés eredménye -- én
--    nem tudtam volna ellenőrizni: a konténeremből semmilyen adatbázist nem
--    érek el (mérve ugyanaznap: `psql` nincs, a 127.0.0.1:5432 ECONNREFUSED).
--
--    ÉS ÉPP EZÉRT ÁLL ITT AZ ÁG, AHELYETT HOGY HIÁNYOZNA: az „üres most" nem
--    ugyanaz, mint „üres a migráció futásakor". A kettő között eltelik idő, és
--    azalatt bárki felvehet egy eszközt a régi állapotban -- a régi érték addig
--    ott áll a felületen. Enélkül a telepítés állna meg egy olyan soron, amiről
--    azt hittük, nem létezik.
--
--    HIDEG TARTALÉK A CÉL, MERT KEVESEBBET ÁLLÍT: a meleg azt mondaná, hogy az
--    eszköz azonnal beáll a helyére, és ezt egyetlen régi sorról sem tudjuk.
ALTER TABLE "Asset"
  ALTER COLUMN "status" TYPE "AssetStatus_new"
  USING (
    CASE "status"::text
      WHEN 'OUT_OF_SERVICE' THEN 'COLD_STANDBY'
      ELSE "status"::text
    END
  )::"AssetStatus_new";

-- 4. A RÉGI TÍPUS ELTŰNIK, AZ ÚJ ÁTVESZI A NEVÉT.
DROP TYPE "AssetStatus";
ALTER TYPE "AssetStatus_new" RENAME TO "AssetStatus";

-- 5. AZ ALAPÉRTELMEZÉS VISSZA. Az `ACTIVE` változatlan, tehát ez nem döntés,
--    csak a 2. lépés visszavonása.
ALTER TABLE "Asset" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
