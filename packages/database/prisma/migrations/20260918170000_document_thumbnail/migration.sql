-- A CSEMPE KÉPE: EGY KICSI, SZERVER-OLDALON ELŐÁLLÍTOTT VÁLTOZAT.
--
-- === A MÉRT HIÁNY ===
--
-- Bélyegkép-út nem létezett: a galéria MINDEN csempéje a teljes méretű fájlból
-- készült. Acrobot mérése az éles adatbázison (2026-09-18, a `0e8abe19`
-- kártyán):
--
--   forrás        legrosszabb   átlagos    rekord   5 MB fölött
--   ServiceJob        416 606     416 606      2         0
--   Worksheet       8 854 411   8 854 411      1         1
--   Asset           9 865 980   5 272 559     17         6
--
-- Egy eszköz-galéria megnyitása átlagosan 5,3 MB letöltés, a legrosszabb
-- 9,9 MB -- és ez HUSZONKILENC kép összesen. A szám nem attól nagy, hogy sok a
-- kép, hanem attól, hogy mindegyik teljes méretű.
--
-- === AMIT EZ A MIGRÁCIÓ NEM CSINÁL ===
--
-- NEM ÉRINT EGYETLEN MEGLÉVŐ SORT SEM. Mind a három oszlop nullázható és
-- alapértelmezés nélküli, tehát a migráció után minden mai sor pontosan úgy
-- viselkedik, ahogy ma: bélyegkép nélkül a csempe az EREDETIRE esik vissza.
--
-- NEM ÍRJA FELÜL AZ EREDETIT. A `content` és a `storageKey` érintetlen, és ez
-- megkötés, nem megvalósítási részlet: a letöltés, a PDF és a hiteles példány
-- továbbra is a teljes méretű fájlból megy.
--
-- NEM TÖLTI FEL A MEGLÉVŐ SOROKAT. A huszonkilenc régi képhez a bélyegkép
-- külön parancsból készül (`documents:thumbnails`), és az szándékosan nem
-- migráció: egy migráció, ami képet dekódol és átméretez, a telepítést tenné
-- függővé egy natív könyvtártól -- és ha ott hasal el, a kiadás áll meg.
--
-- === MIÉRT OSZLOP, ÉS NEM FÁJL A TÁROLÓBAN ===
--
-- A dokumentum bájtjai ma KÉT helyen állhatnak (`content` az adatbázisban VAGY
-- `storageKey` a tárolóban, és a CHECK megszorítás pontosan az egyiket
-- követeli meg). Egy tárolóba írt bélyegkép ezt a kettősséget MEGDUPLÁZNÁN, és
-- a tároló kikapcsolt állapotában külön ágat kívánna.
--
-- Az oszlop ehhez képest EGY hely, és a mérete nem indokol mást: egy 10,7 MB-os
-- fényképből ~33 kB bélyegkép lesz (saját mérés, 2026-09-18). A huszonkilenc
-- meglévő kép teljes bélyegkép-készlete így néhány megabájt.
--
-- A KERETBE NEM SZÁMÍT BELE: a kvóta a `sizeBytes` oszlopok összege, ami az
-- EREDETI mérete. Ez kimondva áll a sémában is, nem hallgatólagosan.

-- AlterTable
ALTER TABLE "AssetDocument" ADD COLUMN "thumbnail" BYTEA;

-- AlterTable
ALTER TABLE "WorksheetDocument" ADD COLUMN "thumbnail" BYTEA;

-- AlterTable
ALTER TABLE "ServiceJobDocument" ADD COLUMN "thumbnail" BYTEA;
