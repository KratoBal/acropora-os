ALTER TABLE "Brand"
ADD COLUMN "normalizedName" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "websiteUrl" TEXT,
ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "metadata" JSONB;

UPDATE "Brand"
SET "normalizedName" = lower(regexp_replace(trim("name"), '[^a-zA-Z0-9]+', ' ', 'g'));

ALTER TABLE "Brand" ALTER COLUMN "normalizedName" SET NOT NULL;
CREATE UNIQUE INDEX "Brand_normalizedName_key" ON "Brand"("normalizedName");
CREATE INDEX "Brand_isActive_name_idx" ON "Brand"("isActive", "name");

CREATE TABLE "BrandAlias" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceExternalId" TEXT,
  "isPreferred" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandAlias_normalizedAlias_key" ON "BrandAlias"("normalizedAlias");
CREATE INDEX "BrandAlias_brandId_source_idx" ON "BrandAlias"("brandId", "source");
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
