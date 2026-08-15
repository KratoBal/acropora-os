-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('SYSTEM', 'EQUIPMENT', 'COMPONENT', 'SENSOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'IN_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCriticality" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'UPDATED', 'PLACEMENT_CHANGED', 'PARENT_CHANGED', 'STATUS_CHANGED', 'QR_ROTATED');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "qrToken" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerAddressId" TEXT,
    "aquariumId" TEXT,
    "parentAssetId" TEXT,
    "productVariantId" TEXT,
    "kind" "AssetKind" NOT NULL DEFAULT 'EQUIPMENT',
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "criticality" "AssetCriticality" NOT NULL DEFAULT 'NORMAL',
    "name" TEXT NOT NULL,
    "category" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "inventoryNumber" TEXT,
    "description" TEXT,
    "installedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "warrantyExpiresAt" TIMESTAMP(3),
    "serviceIntervalDays" INTEGER,
    "lastServicedAt" TIMESTAMP(3),
    "nextServiceAt" TIMESTAMP(3),
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Asset_serviceIntervalDays_check" CHECK ("serviceIntervalDays" IS NULL OR "serviceIntervalDays" >= 1),
    CONSTRAINT "Asset_parent_not_self_check" CHECK ("parentAssetId" IS NULL OR "parentAssetId" <> "id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJobAsset" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceJobAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_assetNumber_key" ON "Asset"("assetNumber");
CREATE UNIQUE INDEX "Asset_qrToken_key" ON "Asset"("qrToken");
CREATE INDEX "Asset_customerId_status_idx" ON "Asset"("customerId", "status");
CREATE INDEX "Asset_customerAddressId_idx" ON "Asset"("customerAddressId");
CREATE INDEX "Asset_aquariumId_idx" ON "Asset"("aquariumId");
CREATE INDEX "Asset_parentAssetId_idx" ON "Asset"("parentAssetId");
CREATE INDEX "Asset_productVariantId_idx" ON "Asset"("productVariantId");
CREATE INDEX "Asset_nextServiceAt_status_idx" ON "Asset"("nextServiceAt", "status");
CREATE INDEX "Asset_serialNumber_idx" ON "Asset"("serialNumber");
CREATE INDEX "Asset_inventoryNumber_idx" ON "Asset"("inventoryNumber");
CREATE INDEX "AssetEvent_assetId_occurredAt_idx" ON "AssetEvent"("assetId", "occurredAt");
CREATE INDEX "AssetEvent_actorUserId_occurredAt_idx" ON "AssetEvent"("actorUserId", "occurredAt");
CREATE UNIQUE INDEX "ServiceJobAsset_serviceJobId_assetId_key" ON "ServiceJobAsset"("serviceJobId", "assetId");
CREATE INDEX "ServiceJobAsset_assetId_createdAt_idx" ON "ServiceJobAsset"("assetId", "createdAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceJobAsset" ADD CONSTRAINT "ServiceJobAsset_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceJobAsset" ADD CONSTRAINT "ServiceJobAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-table ownership (parent/customer, address/customer and aquarium/customer)
-- is intentionally enforced in the validated service layer. PostgreSQL
-- CHECK constraints cannot safely express these referential invariants.
