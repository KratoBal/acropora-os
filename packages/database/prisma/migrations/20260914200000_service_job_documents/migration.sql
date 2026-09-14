-- HIBAJEGYHEZ CSATOLT FENYKEP VAGY EGYEB FAJL.
--
-- Balazs kerese (2026-09-14 19:41): a hibajegy rogzitesekor fotot es egyeb
-- fajlokat is lehessen csatolni.
--
-- UJ TABLA, NEM A MUNKALAPE. A jegynek nem kell munkalapja (a
-- `Worksheet."serviceJobId"` nullazhato, es a jegy-felvitel nem hoz letre
-- lapot), tehat a BEJELENTESKOR tipikusan nincs mire csatolni. A ket kep ezen
-- felul mast bizonyit: a munkalape az ELVEGZETT munkat, a jegye a BEJELENTETT
-- hibat.
--
-- EZ A MIGRACIO SEM AZ `AssetDocument`, SEM A `WorksheetDocument` TABLAHOZ NEM
-- NYUL. Uj tabla, uj enum, ket index, ket idegen kulcs es egy CHECK.

-- CreateEnum
CREATE TYPE "ServiceJobDocumentType" AS ENUM ('PHOTO', 'OTHER');

-- CreateTable
CREATE TABLE "ServiceJobDocument" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "type" "ServiceJobDocumentType" NOT NULL DEFAULT 'PHOTO',
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceJobDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceJobDocument_serviceJobId_createdAt_idx" ON "ServiceJobDocument"("serviceJobId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceJobDocument_sha256_idx" ON "ServiceJobDocument"("sha256");

-- AddForeignKey
ALTER TABLE "ServiceJobDocument" ADD CONSTRAINT "ServiceJobDocument_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobDocument" ADD CONSTRAINT "ServiceJobDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A TARTALOM KET HELYEN ALLHAT, ES PONTOSAN AZ EGYIKEN.
--
-- Ugyanaz a megkotes, mint az `AssetDocument_content_or_storage_key` es a
-- `WorksheetDocument_content_or_storage_key` eseteben, es SZANDEKOSAN ugyanaz:
-- a harom modell elterese azt jelentene, hogy minden kesobbi valtozast
-- haromszor kell megcsinalni, es a harmadik mindig lemarad.
--
-- ADATBAZIS-SZINTEN, NEM CSAK KODBAN: egy hattermunka, egy migracio vagy egy
-- kesobbi vegpont nem orokli az alkalmazas ellenorzeseit, a tabla megkoteset
-- viszont igen.
ALTER TABLE "ServiceJobDocument"
  ADD CONSTRAINT "ServiceJobDocument_content_or_storage_key"
  CHECK (("content" IS NULL) <> ("storageKey" IS NULL));
