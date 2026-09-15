-- A MUNKALAP ALTAL ERINTETT ESZKOZOK.
--
-- Balazs kerese (2026-09-15): a hibajegynel kivalasztott eszkozok jelenjenek meg
-- a belole nyitott munkalapon is.
--
-- EZ NEM ELOTOLTESI HIBA VOLT, HANEM HIANYZO KAPCSOLAT: a `Worksheet` tablanak
-- EGYALTALAN nem volt eszkoz-kapcsolata -- nem elveszett egy ertek, hanem nem is
-- letezett az ut. A jegyen viszont tobb eszkoz all (`ServiceJobAsset`).
--
-- A KAPCSOLOTABLA A LAPE, ES EZ DONTI EL A TORLES IRANYAT: ha a lapot
-- levalasztjak a jegyrol, ezek a sorok MARADNAK. A jegy eszkozei csak az INDULO
-- erteket adjak.
--
-- EZ A MIGRACIO A `ServiceJobAsset` TABLAHOZ NEM NYUL. Uj tabla, egy egyedi
-- kulcs, egy index, ket idegen kulcs.

-- CreateTable
CREATE TABLE "WorksheetAsset" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorksheetAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- UGYANAZ AZ ESZKOZ EGY LAPON CSAK EGYSZER. A felulet tobbszoros valasztast
-- enged, es egy ketszer bekuldott azonosito kulonben ket sort hagyna.
CREATE UNIQUE INDEX "WorksheetAsset_worksheetId_assetId_key" ON "WorksheetAsset"("worksheetId", "assetId");

-- CreateIndex
-- AZ ESZKOZ FELOLI OLVASAS UTJA: "melyik lapok erintettek ezt az eszkozt".
CREATE INDEX "WorksheetAsset_assetId_createdAt_idx" ON "WorksheetAsset"("assetId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorksheetAsset" ADD CONSTRAINT "WorksheetAsset_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- `Restrict`, ugyanugy, mint a jegynel: egy eszkoz torlese nem viheti magaval a
-- munkalap tortenetet.
ALTER TABLE "WorksheetAsset" ADD CONSTRAINT "WorksheetAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
