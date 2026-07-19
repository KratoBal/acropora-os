-- CreateEnum
CREATE TYPE "BrandResolutionReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'NO_BRAND');

-- AlterEnum
ALTER TYPE "CatalogImportStatus" ADD VALUE 'APPROVED';
ALTER TYPE "CatalogImportStatus" ADD VALUE 'APPLIED';
ALTER TYPE "CatalogImportStatus" ADD VALUE 'STALE';

-- DropIndex
DROP INDEX "Category_name_key";

-- AlterTable
ALTER TABLE "BrandResolutionReview"
ADD COLUMN "resolvedBrandKey" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedBy" TEXT,
DROP COLUMN "status",
ADD COLUMN "status" "BrandResolutionReviewStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "CatalogImportBatch"
ADD COLUMN "appliedAt" TIMESTAMP(3),
ADD COLUMN "appliedBy" TEXT,
ADD COLUMN "applyReport" JSONB,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedBy" TEXT;

-- CreateIndex
CREATE INDEX "BrandResolutionReview_batchId_status_idx" ON "BrandResolutionReview"("batchId", "status");

-- CreateIndex
CREATE INDEX "BrandResolutionReview_proposedBrandKey_status_idx" ON "BrandResolutionReview"("proposedBrandKey", "status");
