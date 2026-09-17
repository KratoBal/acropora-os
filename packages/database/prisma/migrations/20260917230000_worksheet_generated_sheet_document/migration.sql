-- A LEZARASKOR GENERALT MUNKALAP HELYE: verzio-kotes es kulon dokumentum-tipus.
--
-- Balázs döntése, 2026-09-17 16:06:58, Discord, a digitális aláírás szálban, egy
-- szóval ("Mehet") mind a három tételre: a fájl a munkalap LEZÁRÁSAKOR keletkezik
-- EGYSZER, és onnantól a TÁROLT fájl a hiteles; a lapon az áll, ami a vevőnek
-- szól; a piszkozat is kap lapot, látható jelöléssel.
--
-- Ez a migráció a fájl HELYÉT készíti elő. A lap TARTALMA (mely mezők kerülnek
-- rá) külön kérdés, és Balázs válaszára vár -- ide semmi nem kerül belőle.
--
-- === MIÉRT KELL VERZIÓ-KÖTÉS, HOLOTT A TÁBLA MÁR LÉTEZIK ===
--
-- A `WorksheetDocument` ma a MUNKALAPHOZ tartozik. Egy feltöltött fényképnél ez
-- helyes: egy készülék fényképe nem egy verzióról szól. A lezáráskor generált lap
-- viszont EGY VERZIÓ tartalmát rögzíti, és egy munkalapnak több verziója lehet --
-- mérve a mai főágon: a módosítás MINDIG új verziót hoz létre
-- (`version = current.version + 1`), és a piszkozat is kap lapot.
--
-- Verzió-kötés nélkül két lezárás két fájlt tenne ugyanarra a munkalapra, és semmi
-- nem mondaná meg, melyik melyik. Éppen az a kérdés maradna nyitva, amire a
-- "a tárolt fájl a hiteles" döntés válaszolni akar.
--
-- === ÉS MIÉRT NEM ELÉG AZ `OTHER` TÍPUS ===
--
-- Az `OTHER` alatt ma kézzel feltöltött fájlok állnak. Ha a generált lap is oda
-- kerülne, egy feltöltött PDF MEGKÜLÖNBÖZTETHETETLEN lenne tőle -- és a hitelesnek
-- nevezett sorra bárki írhatna.
--
-- === A MA LÉTEZŐ SOROK, KIMONDVA ===
--
-- Az új oszlop NULLÁZHATÓ, és minden meglévő sor `NULL` marad: azok fényképek és
-- feltöltött csatolmányok, amelyek NEM egy verzióhoz tartoznak. A migráció tehát
-- egyetlen meglévő sort sem ír át, és nem is igényel visszatöltést.
--
-- Az egyedi megkötés a `(worksheetVersionId, type)` páron áll, és a Postgres TÖBB
-- NULL-t megenged egy egyedi indexben -- a fényképekre ezért nem hat. Ahol viszont
-- ki van töltve, ott verziónként és típusonként EGY sor lehet: az "egy verzióhoz
-- egy hiteles lap" így nem szokás, hanem szerkezet.

-- Az `ALTER TYPE ... ADD VALUE` Postgresben csak akkor futtatható biztonságosan
-- ugyanabban a tranzakcióban, amelyik hozzáadja, ha a migráció az új értéket NEM
-- használja fel DML-ben is -- itt nem használja. (Ugyanez az indok áll a
-- 20260727120000_m8_2_invoicing_state_machine_rework migrációban is; a repó
-- eddigi enum-bővítései mind ezt az alakot használják.)
ALTER TYPE "WorksheetDocumentType" ADD VALUE 'GENERATED_SHEET';

ALTER TABLE "WorksheetDocument" ADD COLUMN "worksheetVersionId" TEXT;

CREATE UNIQUE INDEX "WorksheetDocument_worksheetVersionId_type_key"
  ON "WorksheetDocument"("worksheetVersionId", "type");

ALTER TABLE "WorksheetDocument"
  ADD CONSTRAINT "WorksheetDocument_worksheetVersionId_fkey"
  FOREIGN KEY ("worksheetVersionId") REFERENCES "WorksheetVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
