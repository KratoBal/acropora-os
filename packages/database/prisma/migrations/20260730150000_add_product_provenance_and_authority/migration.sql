-- CreateEnum
CREATE TYPE "ProductOrigin" AS ENUM ('UNAS', 'LOCAL');

-- CreateEnum
CREATE TYPE "ProductCatalogAuthority" AS ENUM ('UNAS', 'ACROPORA');

-- Expand first: the columns intentionally remain nullable until the
-- production preflight and backfill have been verified. A later contract
-- migration can safely add NOT NULL constraints.
ALTER TABLE "Product"
ADD COLUMN "origin" "ProductOrigin",
ADD COLUMN "catalogAuthority" "ProductCatalogAuthority",
ADD COLUMN "createdById" TEXT;

-- Deterministic compatibility backfill. mirrorSource is the existing source
-- of truth for the M2.1 read-only UNAS mirror. Conflicting legacy references
-- are reported by diagnostics/product-provenance-preflight.sql and are not
-- silently promoted to UNAS authority here.
UPDATE "Product"
SET
  "origin" = CASE
    WHEN "mirrorSource" = 'UNAS' THEN 'UNAS'::"ProductOrigin"
    ELSE 'LOCAL'::"ProductOrigin"
  END,
  "catalogAuthority" = CASE
    WHEN "mirrorSource" = 'UNAS' THEN 'UNAS'::"ProductCatalogAuthority"
    ELSE 'ACROPORA'::"ProductCatalogAuthority"
  END;

-- CreateIndex
CREATE INDEX "Product_createdById_idx" ON "Product"("createdById");

-- CreateIndex
CREATE INDEX "Product_origin_catalogAuthority_idx"
ON "Product"("origin", "catalogAuthority");

-- AddForeignKey
ALTER TABLE "Product"
ADD CONSTRAINT "Product_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
