-- Az eszköz áramfelvétele (A, szöveg) és bekötése (I. / III. fázis), a régi kW-szám helyett.
--
-- Balázs kérése (Szerviz és eszköznyilvántartás szál, 2026-10-21 09:03 és 09:05 UTC, kanban
-- 541e2716), röviden:
--   1. ahol a "Fogyasztás (eredeti bejegyzés)" (powerConsumptionRaw) ÜRES, oda a kW-ban megadott
--      szám kerül, magyar alakban, felesleges nullák nélkül, " kW" tagolással ("0,75 kW");
--   2. utána a "Fogyasztás" szám (powerConsumption) MINDEN soron kiürül;
--   3. a mező "Áramfelvétel" lesz, SZÖVEG ("6,15/5,5", A-ben): átnevezve currentDraw-ra;
--   4. új "Bekötés" választó: "I. fázis" / "III. fázis" (üres is lehet).
--
-- AZ ADATLÉPÉS (1. és 2.) ÍR, ÉS IDEMPOTENS (a szerkezeti lépések is újrafuttathatók): egy DO blokk csak akkor fut, ha a régi, DECIMAL
-- típusú `powerConsumption` oszlop még megvan. Egy másodszori futás (vagy egy olyan adatbázis, ahol
-- már átnevezték) semmit nem csinál, tehát nem tud sem felülírni, sem elveszteni semmit. A másolás
-- a kiürítés ELŐTT megy, ugyanabban a tranzakcióban (a migráció egy tranzakció): egy hiba mindkettőt
-- visszagörgeti.
--
-- AMIT A MÁSOLÁS NEM ÍR FELÜL: egy sor, ahol az eredeti bejegyzés NEM üres (a "6,15/5,5"-ös
-- sorok és minden kézzel beírt szöveg) érintetlen marad, a régi kW-szám pedig a sorban eldobódik,
-- mert a 2. lépés ezt kéri. Üres az, ahol NULL, vagy csak szóköz áll benne.
--
-- ROLLBACK: az adatlépés NEM fordítható vissza (a kW-szám kiürül). Visszaállítás csak mentésből;
-- a szövegben viszont az érték benne van ("0,75 kW"), tehát a szám a szövegből visszaolvasható.
-- Az oszlopok: DROP COLUMN "phaseConnection"; DROP TYPE "AssetPhaseConnection"; a "currentDraw"
-- oszlop átnevezhető vissza, típusa DECIMAL(19,6) lehet (üres).

-- CreateEnum (idempotens: egy masodik futas nem dob duplikalt-tipus hibat)
DO $$
BEGIN
  CREATE TYPE "AssetPhaseConnection" AS ENUM ('PHASE_1', 'PHASE_3');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 1. és 2.: az adat
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Asset'
      AND column_name = 'powerConsumption'
      AND data_type = 'numeric'
  ) THEN
    UPDATE "Asset"
    SET "powerConsumptionRaw" =
      replace(trim_scale("powerConsumption")::text, '.', ',') || ' kW'
    WHERE "powerConsumption" IS NOT NULL
      AND COALESCE(btrim("powerConsumptionRaw"), '') = '';

    UPDATE "Asset" SET "powerConsumption" = NULL
    WHERE "powerConsumption" IS NOT NULL;
  END IF;
END
$$;

-- 3.: az oszlop átnevezése és szöveggé tétele (az adat már üres, a típusváltás biztonságos)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Asset'
      AND column_name = 'powerConsumption'
  ) THEN
    ALTER TABLE "Asset" RENAME COLUMN "powerConsumption" TO "currentDraw";
    ALTER TABLE "Asset"
      ALTER COLUMN "currentDraw" TYPE TEXT USING NULL;
  END IF;
END
$$;

-- 4.: a bekötés
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "phaseConnection" "AssetPhaseConnection";
