-- ELORE NYOMTATOTT MATRICAK KESZLETE.
--
-- A matrica ELOBB letezik, mint az eszkoz, ezert a kod nem lehet oszlop az
-- Asset tablan: egy kiadott, de meg senkihez nem tartozo kodot ott nem lehetne
-- tarolni. A reszletes indoklas a semaban all, az AssetLabel modell folott.

-- AlterEnum
ALTER TYPE "AssetEventType" ADD VALUE 'LABEL_ASSIGNED';

-- CreateTable
CREATE TABLE "AssetLabel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT,
    "assignedAt" TIMESTAMP(3),

    CONSTRAINT "AssetLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetLabel_code_key" ON "AssetLabel"("code");

-- CreateIndex
--
-- A NULL NEM EGYENLO ONMAGAVAL, ES EZ ITT SZANDEKOS. Egy egyedi index a
-- nullazhato "assetId" oszlopon AKARHANY szabad matricat megenged (mind NULL),
-- de eszkozonkent csak EGYET, amint hozzarendeltuk. Pontosan ez a ket szabaly
-- kellett: sok szabad kod, eszkozonkent egy.
CREATE UNIQUE INDEX "AssetLabel_assetId_key" ON "AssetLabel"("assetId");

-- CreateIndex
CREATE INDEX "AssetLabel_assetId_issuedAt_idx" ON "AssetLabel"("assetId", "issuedAt");

-- AddForeignKey
--
-- SET NULL, nem CASCADE: egy eszkoz torlese nem semmisitheti meg a matricat,
-- mert az fizikailag ott marad valamin. A sor visszakerul a szabad keszletbe.
ALTER TABLE "AssetLabel" ADD CONSTRAINT "AssetLabel_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A KOD ALAKJA A TABLAN ALL, NEM CSAK A DTO-BAN.
--
-- Egy betu es negy szam (Balazs dontese, 2026-09-02, a 42056ab0 kartyan;
-- pelda: V2196). Azert adatbazis-szintu megkotes, mert egy migracio, egy
-- hattermunka vagy egy kesobbi vegpont NEM orokli az alkalmazas ellenorzeseit,
-- a tabla megkoteset viszont igen.
--
-- CSAK NAGYBETU: a szolgaltatas nagybetusre normalizal beolvasaskor, tehat egy
-- kisbetut ado leolvaso is mukodik -- de a TAROLT alak egyfele, kulonben a
-- "v2196" es a "V2196" ket kulon sor lenne, ket kulon eszkozon.
ALTER TABLE "AssetLabel" ADD CONSTRAINT "AssetLabel_code_shape_check" CHECK ("code" ~ '^[A-Z][0-9]{4}$');

-- A HOZZARENDELES KET MEZOJE EGYUTT MOZOG.
--
-- Egy sor VAGY szabad (assetId NULL es assignedAt NULL), VAGY hozzarendelt
-- (mindketto kitoltve). A ket felallapot (van eszkoz, de nincs idopont, vagy
-- forditva) nem jelent semmit, es a naplobol utolag nem allithato helyre.
ALTER TABLE "AssetLabel" ADD CONSTRAINT "AssetLabel_assignment_pairing_check" CHECK (
    ("assetId" IS NULL AND "assignedAt" IS NULL)
    OR ("assetId" IS NOT NULL AND "assignedAt" IS NOT NULL)
);
