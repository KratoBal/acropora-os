-- A HELYSZINI BEJELENTES IDEMPOTENCIA-KULCSA A HIBAJEGYEN.
--
-- UGYANAZ A MINTA, MINT 2026-09-03-BAN AZ `Asset` ES A `Worksheet` TABLAN
-- (20260903133000_client_operation_id) -- szandekosan egy minta a haromra, nem
-- harom kulon dontes.
--
-- MIERT KELL: a telefon terero nelkul SORBA teszi a jegyet, es a sor a halozati
-- hibat SZANDEKOSAN ujraprobalja. Epp ott lehet viszont, hogy a letrehozas MAR
-- lefutott, es csak a valasz veszett el -- kulcs nelkul az ujrakuldes MASODIK
-- jegyet nyitna ugyanarrol a hibarol, es a szerelo a listan ketszer latna
-- ugyanazt.
--
-- AZ OSZLOP ELHAGYHATO (NULL), es ez a kikotes: a webes felvitel nem kuld
-- kulcsot, es ma is mukodik. Kotelezove teve a mai sorok sem allnanak meg
-- benne. A NULL nem egyenlo onmagaval, tehat az egyedi index a kulcs nelkuli
-- sorokat korlatlanul engedi egymas mellett -- pontosan ezert hasznalhato igy.

-- AlterTable
ALTER TABLE "ServiceJob" ADD COLUMN     "clientOperationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_clientOperationId_key" ON "ServiceJob"("clientOperationId");
