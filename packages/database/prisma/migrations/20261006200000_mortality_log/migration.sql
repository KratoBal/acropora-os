-- AZ ELHULLÁSI NAPLÓ (kártya 115c9740; Balázs promptja 2026-10-06, acrobot
-- döntései 27141). Két új tábla és egy enum; meglévő táblához csak idegen
-- kulcs mutat, oszlop nem változik. A három szabály az adatbázisban is áll, nem
-- csak a DTO-ban: egy későbbi írási út (parancs, import) se kerülhesse meg.

-- CreateEnum
CREATE TYPE "MortalitySourceType" AS ENUM ('SUPPLIER', 'LOCAL_BREEDER', 'TRADE', 'OWN_BREEDING', 'OTHER');

-- CreateTable
CREATE TABLE "MortalityRecord" (
    "id" TEXT NOT NULL,
    "recordNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "sourceType" "MortalitySourceType" NOT NULL,
    "supplierId" TEXT,
    "sourceNote" VARCHAR(200),
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MortalityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MortalityRecordDocument" (
    "id" TEXT NOT NULL,
    "mortalityRecordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "thumbnail" BYTEA,
    "uploadedById" TEXT,
    "caption" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MortalityRecordDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MortalityRecord_recordNumber_key" ON "MortalityRecord"("recordNumber");

-- CreateIndex
CREATE INDEX "MortalityRecord_recordedAt_idx" ON "MortalityRecord"("recordedAt");

-- CreateIndex
CREATE INDEX "MortalityRecord_aquariumId_recordedAt_idx" ON "MortalityRecord"("aquariumId", "recordedAt");

-- CreateIndex
CREATE INDEX "MortalityRecord_productId_idx" ON "MortalityRecord"("productId");

-- CreateIndex
CREATE INDEX "MortalityRecord_supplierId_idx" ON "MortalityRecord"("supplierId");

-- CreateIndex
CREATE INDEX "MortalityRecord_recordedById_idx" ON "MortalityRecord"("recordedById");

-- CreateIndex
CREATE INDEX "MortalityRecordDocument_mortalityRecordId_createdAt_idx" ON "MortalityRecordDocument"("mortalityRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "MortalityRecordDocument_sha256_idx" ON "MortalityRecordDocument"("sha256");

-- AddForeignKey
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityRecordDocument" ADD CONSTRAINT "MortalityRecordDocument_mortalityRecordId_fkey" FOREIGN KEY ("mortalityRecordId") REFERENCES "MortalityRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityRecordDocument" ADD CONSTRAINT "MortalityRecordDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A példányszám legalább 1 (a prompt: "Ne legyen negatív vagy 0 példányszám").
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_quantity_check" CHECK ("quantity" >= 1);

-- Beszállítói forrásnál a beszállító kötelező; más forrásnál nincs beszállító.
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_supplier_check" CHECK (
  ("sourceType" = 'SUPPLIER' AND "supplierId" IS NOT NULL)
  OR ("sourceType" <> 'SUPPLIER' AND "supplierId" IS NULL)
);

-- Az „egyéb” forrásnak neve kell legyen, különben a forrás semmit nem mond.
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_other_note_check" CHECK (
  "sourceType" <> 'OTHER' OR length(btrim(coalesce("sourceNote", ''))) > 0
);
