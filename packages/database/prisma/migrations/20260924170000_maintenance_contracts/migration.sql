CREATE TYPE "ServiceJobKind" AS ENUM ('REPAIR', 'MAINTENANCE');
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

ALTER TABLE "ServiceJob"
  ADD COLUMN "kind" "ServiceJobKind" NOT NULL DEFAULT 'REPAIR',
  ADD COLUMN "contractId" TEXT;

CREATE TABLE "Contract" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3),
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ContractItem" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "unitNet" DECIMAL(19,4) NOT NULL,
  "quantity" DECIMAL(19,6) NOT NULL,
  "occasionsPerYear" INTEGER NOT NULL,
  "vatRatePercent" DECIMAL(5,2) NOT NULL,
  "departmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ContractItemAsset" (
  "contractItemId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  CONSTRAINT "ContractItemAsset_pkey" PRIMARY KEY ("contractItemId", "assetId")
);
CREATE TABLE "ContractDocument" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "content" BYTEA,
  "storageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contract_number_key" ON "Contract"("number");
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");
CREATE UNIQUE INDEX "ContractItem_contractId_position_key" ON "ContractItem"("contractId", "position");
CREATE INDEX "ContractItem_departmentId_idx" ON "ContractItem"("departmentId");
CREATE INDEX "ContractItemAsset_assetId_idx" ON "ContractItemAsset"("assetId");
CREATE INDEX "ContractDocument_contractId_createdAt_idx" ON "ContractDocument"("contractId", "createdAt");
CREATE INDEX "ServiceJob_kind_idx" ON "ServiceJob"("kind");
CREATE INDEX "ServiceJob_contractId_idx" ON "ServiceJob"("contractId");

ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContractItemAsset" ADD CONSTRAINT "ContractItemAsset_contractItemId_fkey"
  FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractItemAsset" ADD CONSTRAINT "ContractItemAsset_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDocument" ADD CONSTRAINT "ContractDocument_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
