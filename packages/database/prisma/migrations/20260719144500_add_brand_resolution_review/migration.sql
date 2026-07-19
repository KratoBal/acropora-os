-- AlterTable
ALTER TABLE "CatalogImportBatch" ADD COLUMN "analysisVersion" TEXT NOT NULL DEFAULT 'legacy';

-- CreateTable
CREATE TABLE "BrandResolutionReview" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "importRowId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposedBrandKey" TEXT,
    "confidence" INTEGER NOT NULL,
    "reviewReasons" JSONB NOT NULL,
    "resolution" JSONB NOT NULL,
    "resolverVersion" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandResolutionReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandResolutionReview_importRowId_key" ON "BrandResolutionReview"("importRowId");

-- CreateIndex
CREATE INDEX "BrandResolutionReview_batchId_status_idx" ON "BrandResolutionReview"("batchId", "status");

-- CreateIndex
CREATE INDEX "BrandResolutionReview_proposedBrandKey_status_idx" ON "BrandResolutionReview"("proposedBrandKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandResolutionReview_batchId_sourceRowNumber_key" ON "BrandResolutionReview"("batchId", "sourceRowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogImportBatch_provider_fileSha256_analysisVersion_key" ON "CatalogImportBatch"("provider", "fileSha256", "analysisVersion");

-- AddForeignKey
ALTER TABLE "BrandResolutionReview" ADD CONSTRAINT "BrandResolutionReview_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandResolutionReview" ADD CONSTRAINT "BrandResolutionReview_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "CatalogImportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
