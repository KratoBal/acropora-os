-- A naplo-sor FAJTAJA KIMONDOTT OSZLOP LESZ (ADR-013).
--
-- Eddig a `ServiceJobEvent` egyetlen esemenyt tudott: az allapotvaltast. A
-- jegy naploja viszont tobbet mutat ennel -- ma a csatolt munkalapok a lap
-- SAJAT keletkezesi idejevel jelennek meg benne, tehat egy harom hete felvett
-- lap harom hetes sorkent all ott, akkor is, ha MA kerult a jegy ala.
--
-- MIERT KULON OSZLOP, ES NEM A `toStatus` OPCIONALISSA TETELE: ha a fajtat egy
-- mezo HIANYA jelezne, akkor egy ELFELEJTETT `toStatus` pontosan ugy nezne ki,
-- mint egy szandekosan mas fajtaju esemeny, es a tevedes NEM SZOLNA. A hiany
-- rossz jel: nem lehet megkulonboztetni a szandekot a mulasztastol.
--
-- A MEGLEVO SOROK ERTELME NEM VALTOZIK, ES EZT AZ ALAPERTEK MONDJA KI: a
-- migracio pillanataban minden tarolt sor allapotvaltas volt, es mindegyik
-- explicit 'STATUS_CHANGE' erteket kap. Nem marad olyan sor, aminek a fajtajat
-- egy masik mezobol kellene visszafejteni.
CREATE TYPE "ServiceJobEventKind" AS ENUM ('STATUS_CHANGE', 'WORKSHEET_ATTACHED', 'WORKSHEET_DETACHED');

ALTER TABLE "ServiceJobEvent"
  ADD COLUMN "kind" "ServiceJobEventKind" NOT NULL DEFAULT 'STATUS_CHANGE';

-- A `toStatus` nullazhatova valik, mert egy munkalap-esemenynek nincs
-- cel-allapota. A FAJTAT ettol fuggetlenul a `kind` mondja meg: ez a lepes
-- csak azt engedi meg, hogy a mezo ures legyen ott, ahol nincs ertelme.
ALTER TABLE "ServiceJobEvent"
  ALTER COLUMN "toStatus" DROP NOT NULL;

-- A munkalap, amelyikrol az esemeny szol.
ALTER TABLE "ServiceJobEvent"
  ADD COLUMN "worksheetId" TEXT;

-- `SET NULL` a torlesre, nem `CASCADE`: ami megtortent, megtortent. Egy torolt
-- munkalap nem viheti magaval a jegy naplojat -- ugyanaz a szabaly, mint az
-- aktornal.
ALTER TABLE "ServiceJobEvent" ADD CONSTRAINT "ServiceJobEvent_worksheetId_fkey"
  FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- INDEX A HIVATKOZASON, ES NEM ELORELATASBOL: a Postgres a kulso kulcsot NEM
-- indexeli magatol, a `SET NULL` viszont MINDEN munkalap-torlesnel vegigmegy
-- ezen az oszlopon. Index nelkul ez teljes tablabejaras lenne, jegyenkent.
CREATE INDEX "ServiceJobEvent_worksheetId_idx" ON "ServiceJobEvent"("worksheetId");

-- A MEZOK ES A FAJTA EGYUTT ALLASA, ADATBAZIS-SZINTEN.
--
-- Enelkul a `kind` csak egy CIMKE lenne a sor mellett, es keletkezhetne
-- 'STATUS_CHANGE' sor cel-allapot nelkul (pontosan az az allapot, amit ez a
-- migracio meg akar szuntetni), vagy munkalap-esemeny munkalap nelkul.
--
-- A `toStatus IS NULL` a munkalap-esemenyeken SZANDEKOS SZIGOR: egy kitoltott
-- cel-allapot egy csatolasi soron ket olvasatot adna ugyanannak a sornak, es a
-- diszkriminator epp azert van, hogy PONTOSAN egy olvasat legyen.
ALTER TABLE "ServiceJobEvent"
  ADD CONSTRAINT "ServiceJobEvent_kind_fields_agree" CHECK (
    ("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL AND "worksheetId" IS NULL)
    OR ("kind" IN ('WORKSHEET_ATTACHED', 'WORKSHEET_DETACHED') AND "toStatus" IS NULL AND "worksheetId" IS NOT NULL)
  );
