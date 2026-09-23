-- A fogyasztás mezője DECIMAL lesz, és megjelenik mellette az eredeti szöveg.
--
-- Balázs kérése, 2026-09-23 (kanban 8c77cf3e), Discord: "igen, össze akarja
-- adni". A korábbi migráció (20260923114800_asset_power_consumption) a
-- `powerConsumption` mezőt SZÖVEGKÉNT hozta létre -- helyesen, a mérés
-- alapján, amit akkor ismertünk (a FANK-adatok fele "P1/P2" alakú). Az
-- azóta megjött válasz szerint viszont a fogyasztást ÖSSZE KELL ADNI egy
-- rendszerre, ami csak számon működik.
--
-- === MIÉRT ÚJ MIGRÁCIÓ, ÉS NEM A RÉGI SZERKESZTÉSE ===
--
-- A 20260923114800 migráció ezen a nyitott PR-en (#1022) még NEM lett
-- beolvasztva, tehát megosztott (dev/staging/éles) adatbázison sosem futott
-- -- de a szabály, hogy egy migrációt nem szerkesztünk utólag, akkor is
-- betartandó, ha valaki már lehúzta az ágat és lokálisan lefuttatta: egy
-- átírt fájl checksum-ütközést adna neki a következő migrálásnál. Az ÚJ
-- migráció ezt elkerüli, a szokásos úton.
--
-- === A SORREND SZÁMÍT: ELŐBB MÁSOL, CSAK AZTÁN ALAKÍT ===
--
-- Ha ezen a migráción valaha átment volna egy sor "P1/P2" alakú
-- `powerConsumption` szöveggel, a puszta típusváltás CSENDBEN eldobná: a
-- DECIMAL cast nem érti a "6,15/5,5" alakot. Ezért a régi szöveg ELŐBB
-- átmásolódik a `powerConsumptionRaw` oszlopba, VÁLTOZATLANUL, és csak
-- utána alakul a `powerConsumption` DECIMAL-lá -- ahol a nem tisztán
-- numerikus érték NULL lesz benne, de a `powerConsumptionRaw`-ban megmarad.
-- Ma ez a lépés üres táblán fut (a funkció percekkel ezelőtt készült, még
-- egyetlen valódi eszközön sincs kitöltve), de a migráció így akkor is
-- helyes, ha ez valaha nem lenne igaz.
ALTER TABLE "Asset" ADD COLUMN "powerConsumptionRaw" TEXT;

UPDATE "Asset" SET "powerConsumptionRaw" = "powerConsumption"
WHERE "powerConsumption" IS NOT NULL;

ALTER TABLE "Asset"
  ALTER COLUMN "powerConsumption" TYPE DECIMAL(19,6)
  USING (
    CASE
      WHEN "powerConsumption" ~ '^[0-9]+(\.[0-9]+)?$'
        THEN "powerConsumption"::DECIMAL(19,6)
      ELSE NULL
    END
  );
