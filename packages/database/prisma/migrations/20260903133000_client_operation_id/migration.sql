-- A HELYSZINI ROGZITES IDEMPOTENCIA-KULCSA, KET TABLAN, EGY MINTA SZERINT.
--
-- A telefon terero nelkul SORBA teszi a felvitelt, es a sor a halozati hibat
-- SZANDEKOSAN ujraprobalhatonak veszi -- offline epp az a normalis allapot.
-- Csakhogy pontosan ott lehet, hogy a szerver MAR letrehozta a rekordot, es
-- csak a valasz veszett el: kulcs nelkul az ujrakuldes MASODIK rekordot hozna
-- letre.
--
-- AZ OSZLOP ELHAGYHATO (NULL), es ez a kikotes: a webes felvitel nem kuld
-- kulcsot, es ma mukodik. Kotelezove teve a mai sorok sem allnanak meg benne.
-- A NULL nem egyenlo onmagaval, tehat az egyedi index a kulcs nelkuli sorokat
-- korlatlanul engedi egymas mellett -- pontosan ezert hasznalhato igy.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "clientOperationId" TEXT;

-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "clientOperationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_clientOperationId_key" ON "Asset"("clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "Worksheet_clientOperationId_key" ON "Worksheet"("clientOperationId");
