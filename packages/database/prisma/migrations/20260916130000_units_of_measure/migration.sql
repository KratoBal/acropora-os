-- KARBANTARTOTT MERTEKEGYSEG-LISTA, ES AZ ESZKOZ TELJESITMENYE.
--
-- Balazs kerese (2026-09-16): az eszkozon legyen TELJESITMENY mezo, mellette
-- mertekegyseg-legordulo, es a mertekegysegek a Beallitasok ala keruljenek.
--
-- === MIERT VAN FAJTA-OSZLOP, ES MIERT MOST ===
--
-- A semaban MA TIZ szabad szoveges mertekegyseg-mezo all, es azok legalabb KET,
-- egymassal nem keverheto vilagbol valok: MENNYISEGEK (db, ora, ml -- termek,
-- rendeles, szamla, munkalap) es MERESEK (mg/l, C-fok, mikrogramm/l -- akvarium,
-- ICP). Az eszkoz teljesitmenye egy harmadik.
--
-- Egy lapos, fajta nelkuli lista mukodne, es pont HASZNALAT kozben lenne rossz:
-- egy munkalap-tetelsor felkinalna a mikrogramm/l-t. A fajta ezert a TABLAN all.
--
-- ES A FAJTA AZT MONDJA MEG, MIT MER AZ EGYSEG -- NEM AZT, HOL VALASZTHATO.
-- A ketto ma egybeesik, es epp ezert nem latszik. Elvalik abban a percben,
-- amikor egy egyseg ket helyen is ertelmes lesz (a `l/h` teljesitmeny IS, es egy
-- tetelsoron mennyiseg IS lehet). Akkor a HASZNALATI HELY kulon fogalom lesz, es
-- ez az oszlop marad az, ami. Reszletesen a sema `UnitOfMeasureKind` fejlecen.
--
-- Es azert MOST: egy megkulonbozteto oszlop ma egy enum-mezo. Kesobb azt
-- jelentene, hogy a mar felvitt sorokra vissza kell TALALGATNI a fajtat,
-- mikozben minden addigi valaszto ugy van megirva, hogy EGY lista letezik.
--
-- === A NEV NEM `Unit`, ES EZ MERESEN ALL ===
--
-- A semaban a "unit" szo HAROM dolgot jelent: mertekegyseg, SZERVEZETI EGYSEG
-- (helyszin) es EGYSEGAR. A masodik foglalja a kodbazist: az `Asset.unitId` a
-- HELYSZIN. Egy `Unit` nevu tabla mellett az `asset.unitId` es az `asset.unitId`
-- kozott semmi nem mondana meg a kulonbseget.
--
-- === AMIHEZ EZ A MIGRACIO NEM NYUL ===
--
-- A tiz meglevo szabad szoveges mezohoz EGYIKHEZ SEM. Azok atallitasa kulon
-- dontes es kulon migracio; ez a tabla ugy keszult, hogy oda is hasznalhato
-- legyen (`kind = 'QUANTITY'`), tehat masodik lista nem fog kelleni.

-- CreateEnum
CREATE TYPE "UnitOfMeasureKind" AS ENUM ('QUANTITY', 'MEASUREMENT', 'PERFORMANCE');

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "UnitOfMeasureKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- A KOD A FAJTAJAN BELUL EGYEDI, nem globalisan: egy jel ket vilagban is allhat
-- (a `l` mennyiseg is, meres is lehet), es egy globalis egyediseg ilyenkor az
-- egyiket ZARNA KI. Visszafele barmikor szukitheto, elore nem nyithato.
CREATE UNIQUE INDEX "UnitOfMeasure_kind_code_key" ON "UnitOfMeasure"("kind", "code");

-- A valaszto lekerdezese: fajtara szurve, aktivak, sorrendben.
CREATE INDEX "UnitOfMeasure_kind_isActive_sortOrder_idx" ON "UnitOfMeasure"("kind", "isActive", "sortOrder");

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "performance" DECIMAL(19,6),
ADD COLUMN     "performanceUnitId" TEXT;

-- A KET MEZO EGYUTT MOZOG.
--
-- Egy "500" onmagaban nem informacio, hanem talalgatasra hivas: watt? liter per
-- ora? A ket felallapot egyike sem jelent semmit, es utolag nem allithato
-- helyre. Ugyanaz az alak, mint a matrica `assignment_pairing_check`-je.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_performance_pairing_check" CHECK (
    ("performance" IS NULL AND "performanceUnitId" IS NULL)
    OR ("performance" IS NOT NULL AND "performanceUnitId" IS NOT NULL)
);

-- `Restrict`, nem `SetNull`: ha valaki olyan mertekegyseget torolne, amire
-- eszkozok hivatkoznak, az NE csendben uritse ki a mezoket. A kivezetes utja az
-- `isActive = false`, ami a valasztobol veszi ki, de a meglevo ertekek mellett
-- olvashato marad.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_performanceUnitId_fkey" FOREIGN KEY ("performanceUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A KEZDO KESZLET: ami nelkul a mezo hasznalhatatlan lenne az elso napon.
--
-- CSAK A TELJESITMENY-FAJTA, es ez szandekos: a mennyisegi es meresi egysegeket
-- MA meg szabad szoveg hordozza tiz helyen, es azok atallitasa kulon dontes. Egy
-- elore feltoltott, de senki altal nem hasznalt lista csak zaj lenne.
INSERT INTO "UnitOfMeasure" ("id", "code", "name", "kind", "sortOrder", "updatedAt") VALUES
    ('uom_perf_w',    'W',    'watt',            'PERFORMANCE', 10, CURRENT_TIMESTAMP),
    ('uom_perf_kw',   'kW',   'kilowatt',        'PERFORMANCE', 20, CURRENT_TIMESTAMP),
    ('uom_perf_lph',  'l/h',  'liter per óra',   'PERFORMANCE', 30, CURRENT_TIMESTAMP),
    ('uom_perf_m3ph', 'm³/h', 'köbméter per óra','PERFORMANCE', 40, CURRENT_TIMESTAMP),
    ('uom_perf_lpm',  'l/perc','liter per perc', 'PERFORMANCE', 50, CURRENT_TIMESTAMP);
