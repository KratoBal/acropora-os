-- SEO P0 PR 11 (C7): the brand page fields on Brand, and the per-brand source domains.
-- Additive only: four nullable columns and one new table, nothing existing is rewritten.
-- CreateEnum
CREATE TYPE "BrandSourceKind" AS ENUM ('MANUFACTURER', 'DISTRIBUTOR', 'RETAILER');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "intro" TEXT,
ADD COLUMN     "merchantBrandName" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT;

-- CreateTable
CREATE TABLE "BrandSourceDomain" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" "BrandSourceKind" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSourceDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandSourceDomain_domain_idx" ON "BrandSourceDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSourceDomain_brandId_domain_key" ON "BrandSourceDomain"("brandId", "domain");

-- AddForeignKey
ALTER TABLE "BrandSourceDomain" ADD CONSTRAINT "BrandSourceDomain_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

