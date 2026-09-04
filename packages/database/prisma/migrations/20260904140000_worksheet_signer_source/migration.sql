-- AZ ALAIRO AZ UGYFEL EMBERE, ES A LAP MEGMONDJA, HONNAN JOTT A NEVE.
--
-- Balazs kerese, 2026-09-04: "szerintem az ugyfel neve legyen legordulobol
-- kvalaszthato (...) Lehet egy olyan ertek a legorduloben, hogy egyik sem es
-- akkor johet a szovegmezo ahova a szerelo beirja a nevet, de akkor ezt jelezni
-- kell, hogy nem az irta ala akie a munkalap."
--
-- A JELZES TAROLT ALLAPOT, NEM KEPERNYO-SZOVEG (acrobot dontese ugyanaznap).
-- Egy kepernyore irt mondat a kovetkezo valtozassal eltunik; a soron tarolt
-- allapot megmarad, es a lap ket honap mulva is megmondja, melyik agon
-- keletkezett.
--
-- === ES A REGI SOROKAT SZANDEKOSAN NEM TOLTJUK FEL ===
--
-- 2026-09-04 elott ugyanaz az oszlop (`signerName`) KET DOLGOT jelentett: a
-- mobilon a SZERELO nevet (a keperno a bejelentkezett felhasznaloval irta ala),
-- a weben az UGYFELET (szabad szoveges mezo). Visszamenoleg nem tudjuk
-- eldonteni, melyik sor melyik -- es egy kitalalt ertek rosszabb, mint egy
-- ketertelmu, mert ugy nezne ki, mintha tudnank.
--
-- Ezert a `signerSource` a regi sorokon `NULL` marad, es A HIANY MAGA A
-- MEGKULONBOZTETES: ahol nincs ertek, ott a lap nem allit semmit arrol, ki irta
-- ala. Az uj sorok viszont mindig allitanak.

-- CreateEnum
CREATE TYPE "WorksheetSignerSource" AS ENUM ('SELECTED', 'TYPED');

-- AlterTable
ALTER TABLE "WorksheetVersionSignature" ADD COLUMN "signerUserId" TEXT;
ALTER TABLE "WorksheetVersionSignature" ADD COLUMN "signerSource" "WorksheetSignerSource";

-- CreateIndex
-- A `SetNull` idegenkulcs ellenorzese MINDEN felhasznalo-torlesnel lefut, es
-- index nelkul vegigolvasna a tablat.
CREATE INDEX "WorksheetVersionSignature_signerUserId_idx" ON "WorksheetVersionSignature"("signerUserId");

-- AddForeignKey
-- SET NULL: az alairas TENYE nem tunhet el egy fiok torlesevel. A nev a soron
-- marad, csak a szemelyre mutato hivatkozas szunik meg.
ALTER TABLE "WorksheetVersionSignature" ADD CONSTRAINT "WorksheetVersionSignature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
