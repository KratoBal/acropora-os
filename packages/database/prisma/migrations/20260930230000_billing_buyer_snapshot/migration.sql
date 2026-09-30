-- A vevő pillanatképe a kiállítás pillanatában (Számlázás brief, lista és
-- részletek, 15. pont). Egy NULL-ozható oszlop; a régi sorokra NULL (vázlat, vagy
-- a modul előtti sor). Meglévő sort nem ír át.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerSnapshot" JSONB;

