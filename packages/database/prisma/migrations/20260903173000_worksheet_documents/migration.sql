-- MUNKALAPHOZ CSATOLT FENYKEP.
--
-- A KEP A LAPHOZ KOTODIK, nem a verziohoz: a verzio a lap SZOVEGE, es egy
-- alairt verzio valtozatlan. Egy kesobb erkezo fenykep vagy nem ferne fel, vagy
-- egy alairt rekordot irna at -- egyik sem vallalhato.
--
-- EZ A MIGRACIO AZ `AssetDocument` TABLAHOZ NEM NYUL. Uj tabla, uj enum, ket
-- index es ket idegen kulcs; a meglevo eszkoz-dokumentumok viselkedese
-- valtozatlan. (Kikotes: acrobot, 11553.)
-- CreateEnum
CREATE TYPE "WorksheetDocumentType" AS ENUM ('PHOTO', 'OTHER');

-- CreateTable
CREATE TABLE "WorksheetDocument" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "type" "WorksheetDocumentType" NOT NULL DEFAULT 'PHOTO',
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorksheetDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorksheetDocument_worksheetId_createdAt_idx" ON "WorksheetDocument"("worksheetId", "createdAt");

-- CreateIndex
CREATE INDEX "WorksheetDocument_sha256_idx" ON "WorksheetDocument"("sha256");

-- AddForeignKey
ALTER TABLE "WorksheetDocument" ADD CONSTRAINT "WorksheetDocument_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetDocument" ADD CONSTRAINT "WorksheetDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A TARTALOM KET HELYEN ALLHAT, ES PONTOSAN AZ EGYIKEN.
--
-- Ugyanaz a megkotes, mint az `AssetDocument_content_or_storage_key` esetében,
-- es SZANDEKOSAN ugyanaz: a ket modell elterese azt jelentene, hogy minden
-- kesobbi valtozast ketszer kell megcsinalni.
--
-- ADATBAZIS-SZINTEN, NEM CSAK KODBAN: egy hattermunka, egy migracio vagy egy
-- kesobbi vegpont nem orokli az alkalmazas ellenorzeseit, a tabla megkoteset
-- viszont igen.
ALTER TABLE "WorksheetDocument"
  ADD CONSTRAINT "WorksheetDocument_content_or_storage_key"
  CHECK (("content" IS NULL) <> ("storageKey" IS NULL));
