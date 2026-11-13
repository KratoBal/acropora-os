-- ÜZEMELTETÉSI NAPLÓ, S1: A FELADAT-SABLON ÉS A MEZŐI (task os-uzemeltetesi-naplo, kártya bcaa0651; Balázs 2026-11-13
-- 07:52 UTC "igen"; brief: exchange/uzemeltetesi-naplo/brief-2026-11-13.md).
--
-- ÚJ, ÜRES TÁBLÁK ÉS ENUMOK, MEGLÉVŐ SORHOZ NEM NYÚL. A bejegyzés (a rögzítés), a rendellenesség-hibajegy, a havi kimutatás és
-- a partner-nézet a következő szeletek, azok a saját tábláikkal jönnek.
--
-- A KÉT CHECK ÉS A RÉSZLEGES EGYEDI INDEX KÉZZEL KERÜL IDE, mert a Prisma séma nem tudja kifejezni őket (a séma kommentje
-- mutat ide):
--   1. a sablon PONTOSAN egy célra szól: egy eszközre VAGY egy eszköz-kategóriára (a kettő közül pontosan egy kitöltött);
--   2. a mértékegység és a mérő-szerep CSAK szám mezőnél állhat;
--   3. sablononként legfeljebb egy ELŐTT és egy UTÁN mező (a havi kimutatás vízóra-különbsége egyértelmű legyen).

-- CreateEnum
CREATE TYPE "OperationsTaskFrequency" AS ENUM ('DAILY', 'WEEKLY', 'OCCASIONAL');

-- CreateEnum
CREATE TYPE "OperationsTaskFieldType" AS ENUM ('NUMBER', 'BOOLEAN', 'TEXT', 'PHOTO');

-- CreateEnum
CREATE TYPE "OperationsMeterRole" AS ENUM ('BEFORE', 'AFTER');

-- CreateTable
CREATE TABLE "OperationsTaskTemplate" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "frequency" "OperationsTaskFrequency" NOT NULL,
    "assetId" TEXT,
    "assetCategoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationsTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationsTaskField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "type" "OperationsTaskFieldType" NOT NULL,
    "unit" VARCHAR(16),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "meterRole" "OperationsMeterRole",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsTaskField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationsTaskTemplate_isActive_frequency_idx" ON "OperationsTaskTemplate"("isActive", "frequency");

-- CreateIndex
CREATE INDEX "OperationsTaskTemplate_assetId_idx" ON "OperationsTaskTemplate"("assetId");

-- CreateIndex
CREATE INDEX "OperationsTaskTemplate_assetCategoryId_idx" ON "OperationsTaskTemplate"("assetCategoryId");

-- CreateIndex
CREATE INDEX "OperationsTaskField_templateId_sortOrder_idx" ON "OperationsTaskField"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OperationsTaskField_templateId_key_key" ON "OperationsTaskField"("templateId", "key");

-- AddForeignKey
ALTER TABLE "OperationsTaskTemplate" ADD CONSTRAINT "OperationsTaskTemplate_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsTaskTemplate" ADD CONSTRAINT "OperationsTaskTemplate_assetCategoryId_fkey" FOREIGN KEY ("assetCategoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsTaskField" ADD CONSTRAINT "OperationsTaskField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OperationsTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A SABLON PONTOSAN EGY CÉLRA SZÓL (eszköz XOR eszköz-kategória)
ALTER TABLE "OperationsTaskTemplate"
  ADD CONSTRAINT "OperationsTaskTemplate_one_target"
  CHECK (("assetId" IS NOT NULL) <> ("assetCategoryId" IS NOT NULL));

-- MÉRTÉKEGYSÉG ÉS MÉRŐ-SZEREP CSAK SZÁM MEZŐNÉL
ALTER TABLE "OperationsTaskField"
  ADD CONSTRAINT "OperationsTaskField_unit_only_number"
  CHECK ("unit" IS NULL OR "type" = 'NUMBER');

ALTER TABLE "OperationsTaskField"
  ADD CONSTRAINT "OperationsTaskField_meter_role_only_number"
  CHECK ("meterRole" IS NULL OR "type" = 'NUMBER');

-- SABLONONKÉNT LEGFELJEBB EGY ELŐTT ÉS EGY UTÁN MEZŐ (részleges egyedi index: a NULL szerep nem számít)
CREATE UNIQUE INDEX "OperationsTaskField_templateId_meterRole_key"
  ON "OperationsTaskField"("templateId", "meterRole")
  WHERE "meterRole" IS NOT NULL;
