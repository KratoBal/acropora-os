-- KIKULDES ALAIRASRA: KET UJ, ELHAGYHATO MEZO.
--
-- A lezaras 2026-09-21-ig MAGA tette alairhatova a lapot, tehat minden
-- lezart lap alairhatonak latszott a portalon -- akkor is, ha soha nem
-- kuldtuk ki. Ez a ket mezo valasztja szet a ketto.
--
-- NINCS BACKFILL, ES EZ MERES: az eles adatbazisban NULLA
-- AWAITING_SIGNATURE sor all (a teljes WorksheetVersion tabla negy sor:
-- 2 SIGNED, 2 DRAFT; merve 2026-09-21 18:05, acropora-prod-01,
-- kontener iwm34jaqp9xmwb72qkrqkwhy). A stage-en egyetlen lap all, egy
-- SIGNED verzioval. Nincs olyan meglevo sor, amit a NULL megbenitana.
--
-- A FK SetNull: egy azota torolt felhasznalo nem viheti magaval a lap
-- tortenetet, es a KIKULDES TENYE (sentForSignatureAt) ilyenkor is megmarad.

-- AlterTable
ALTER TABLE "WorksheetVersion" ADD COLUMN     "sentForSignatureAt" TIMESTAMP(3),
ADD COLUMN     "sentForSignatureToUserId" TEXT;

-- AddForeignKey
ALTER TABLE "WorksheetVersion" ADD CONSTRAINT "WorksheetVersion_sentForSignatureToUserId_fkey" FOREIGN KEY ("sentForSignatureToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

