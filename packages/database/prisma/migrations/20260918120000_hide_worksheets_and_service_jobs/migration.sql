-- A REJTÉS: EGY MUNKALAP VAGY EGY HIBAJEGY KIKERÜL A LISTÁKBÓL, DE MEGMARAD.
--
-- Balázs kérése, 2026-09-18 07:44 és 07:45 UTC: tíz próba-sor (hat munkalap,
-- négy hibajegy) tűnjön el az élesből. A kérdésre, hogy a listákról tűnjenek el
-- vagy legyenek végleg törölve, 08:01-kor így válaszolt, szó szerint:
-- "tunjenek el" -- tehát az első ágat választotta.
--
-- === MIÉRT KÉPESSÉG, ÉS NEM EGYSZERI TAKARÍTÁS ===
--
-- Az egyszeri adatbázis-művelet gyorsabb lett volna most, és minden későbbi
-- próbalap ugyanezt a kört igényelné. A rejtés visszavonható, a lánc
-- (hibajegy -> munkalap -> teljesítési igazolás -> számla) ép marad, és
-- legközelebb Balázs maga elvégzi, nem kell szólnia.
--
-- === AMIT EZ A MIGRÁCIÓ NEM CSINÁL ===
--
-- NEM töröl. Sem sort, sem fájlt. A munkalap dokumentumai mögött VALÓDI fájlok
-- állnak a dokumentum-tárolóban; egy rejtés, ami takarít, már törlés, csak más
-- néven.
--
-- NEM szabadítja fel a számot. A `Worksheet.number` egyedi, és a
-- `numberYear`+`sequence` pár adja a partnerenkénti sorszámot. Ha egy rejtett
-- lap száma felszabadulna, két különböző lap viselné ugyanazt a számot, és a
-- papíron már kint lévő példány valami másra mutatna.
--
-- NEM érint egyetlen meglévő sort sem: mind a négy oszlop NULLÁZHATÓ és
-- alapértelmezés nélküli, tehát a migráció után minden mai sor pontosan úgy
-- viselkedik, ahogy ma. A rejtés kizárólag a `hiddenAt` KITÖLTÉSÉVEL áll elő.
--
-- === A KÉT `hiddenById` OSZLOP KÖZÖTT VAN EGY KÜLÖNBSÉG, ÉS SZÁNDÉKOS ===
--
-- A munkalapén IDEGENKULCS áll (`SetNull`), a hibajegyén nem. Mind a két
-- modellen a SAJÁT környezetét követi: a `Worksheet.handedOverById` (a
-- közvetlen szomszéd) kapcsolattal áll, a `ServiceJob` modellen viszont
-- EGYETLEN `User` kapcsolat sincs, és az `openedById` séma-fejléce kimondja,
-- miért. Egy egységes alak az egyik helyen idegen test lett volna.
--
-- A `SetNull` iránya a munkalapon nem részletkérdés: ha a rejtő kolléga sora
-- eltűnik, a lap REJTVE MARAD, csak a név vész el. Kaszkáddal egy törölt
-- kolléga összes rejtése visszaállna, és a próbalapok újra megjelennének.

-- AlterTable
ALTER TABLE "Worksheet"
    ADD COLUMN "hiddenAt" TIMESTAMP(3),
    ADD COLUMN "hiddenById" TEXT;

-- AlterTable
ALTER TABLE "ServiceJob"
    ADD COLUMN "hiddenAt" TIMESTAMP(3),
    ADD COLUMN "hiddenById" TEXT;

-- CreateIndex
-- MINDEN LISTA EZEN SZŰR, ALAPBÓL. A rejtés bevezetése után nincs olyan
-- lista-lekérdezés egyik táblán sem, ami ne nézné ezt az oszlopot.
CREATE INDEX "Worksheet_hiddenAt_idx" ON "Worksheet"("hiddenAt");

-- CreateIndex
CREATE INDEX "ServiceJob_hiddenAt_idx" ON "ServiceJob"("hiddenAt");

-- AddForeignKey
ALTER TABLE "Worksheet"
    ADD CONSTRAINT "Worksheet_hiddenById_fkey"
    FOREIGN KEY ("hiddenById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
