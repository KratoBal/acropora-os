-- Extend the asset event audit trail and introduce typed PDF attachments.
ALTER TYPE "AssetEventType" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "AssetEventType" ADD VALUE 'DOCUMENT_DELETED';

CREATE TYPE "AssetDocumentType" AS ENUM ('INVOICE', 'WARRANTY', 'MANUAL', 'OTHER');

-- Assets may belong either to a customer or to a supplier/partner. Existing
-- rows remain customer-owned; the check guarantees exactly one owner.
ALTER TABLE "Asset" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "Asset" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_exactly_one_owner_check"
  CHECK (num_nonnulls("customerId", "supplierId") = 1);

CREATE INDEX "Asset_supplierId_status_idx" ON "Asset"("supplierId", "status");

CREATE TABLE "AssetDocument" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "type" "AssetDocumentType" NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
  "sizeBytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "content" BYTEA NOT NULL,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssetDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetDocument_assetId_type_createdAt_idx"
  ON "AssetDocument"("assetId", "type", "createdAt");
CREATE INDEX "AssetDocument_sha256_idx" ON "AssetDocument"("sha256");

ALTER TABLE "AssetDocument"
  ADD CONSTRAINT "AssetDocument_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetDocument"
  ADD CONSTRAINT "AssetDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
