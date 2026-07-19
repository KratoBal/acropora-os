-- AlterTable
ALTER TABLE "ProductRelation" ADD COLUMN "source" TEXT;

-- CreateIndex
CREATE INDEX "ProductRelation_sourceProductId_source_idx" ON "ProductRelation"("sourceProductId", "source");
