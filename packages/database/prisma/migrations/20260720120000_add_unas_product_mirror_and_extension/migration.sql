CREATE TYPE "ProductMirrorState" AS ENUM ('ACTIVE', 'MISSING', 'CONFLICT');
CREATE TYPE "UnasProductSyncKind" AS ENUM ('FULL', 'INCREMENTAL');
CREATE TYPE "UnasProductSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLIED', 'FAILED');

ALTER TABLE "Product"
ADD COLUMN "mirrorSource" "ExternalSystem",
ADD COLUMN "mirrorState" "ProductMirrorState",
ADD COLUMN "sourceCreatedAt" TIMESTAMP(3),
ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "missingSince" TIMESTAMP(3),
ADD COLUMN "rawSourceHash" TEXT;

ALTER TABLE "ProductVariant"
ADD COLUMN "manufacturerPartNumber" TEXT,
ADD COLUMN "secondaryUnit" TEXT,
ADD COLUMN "secondaryUnitFactor" DECIMAL(19,6);

ALTER TABLE "SupplierProduct"
ADD COLUMN "minimumOrderQuantity" DECIMAL(19,6),
ADD COLUMN "packageSize" DECIMAL(19,6),
ADD COLUMN "leadTimeDays" INTEGER;

CREATE TABLE "UnasProductSnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currency" VARCHAR(3),
    "netPrice" DECIMAL(19,4),
    "grossPrice" DECIMAL(19,4),
    "saleNetPrice" DECIMAL(19,4),
    "saleGrossPrice" DECIMAL(19,4),
    "saleStartsAt" TIMESTAMP(3),
    "saleEndsAt" TIMESTAMP(3),
    "priceDisplay" TEXT,
    "descriptionShort" TEXT,
    "descriptionLong" TEXT,
    "descriptionShortIsHtml" BOOLEAN,
    "descriptionLongIsHtml" BOOLEAN,
    "productUrl" TEXT,
    "sefUrl" TEXT,
    "manufacturerUrl" TEXT,
    "vatRate" DECIMAL(5,2),
    "propertiesHtml" TEXT,
    "minimumOrderQuantity" DECIMAL(19,6),
    "initialOrderQuantity" DECIMAL(19,6),
    "maximumOrderQuantity" DECIMAL(19,6),
    "orderQuantityStep" DECIMAL(19,6),
    "backorderAllowed" BOOLEAN,
    "variantStockEnabled" BOOLEAN,
    "lowStockThreshold" DECIMAL(19,6),
    "reportedStock" DECIMAL(19,6),
    "reportedStockSyncedAt" TIMESTAMP(3),
    "primaryCategoryExternalId" TEXT,
    "alternativeCategoryExternalIds" JSONB,
    "images" JSONB,
    "parameters" JSONB,
    "seo" JSONB,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnasProductSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductExtension" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "preferredSupplierId" TEXT,
    "defaultPurchaseCurrency" VARCHAR(3),
    "defaultWarehouseId" TEXT,
    "defaultLocationId" TEXT,
    "minimumStock" DECIMAL(19,6),
    "optimalStock" DECIMAL(19,6),
    "reorderPoint" DECIMAL(19,6),
    "safetyStock" DECIMAL(19,6),
    "stockTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "purchasingDisabled" BOOLEAN NOT NULL DEFAULT false,
    "phaseOut" BOOLEAN NOT NULL DEFAULT false,
    "autoReorderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductExtension_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_mirrorSource_mirrorState_idx" ON "Product"("mirrorSource", "mirrorState");
CREATE INDEX "Product_missingSince_idx" ON "Product"("missingSince");
CREATE UNIQUE INDEX "UnasProductSnapshot_productId_key" ON "UnasProductSnapshot"("productId");
CREATE UNIQUE INDEX "ProductExtension_variantId_key" ON "ProductExtension"("variantId");
CREATE INDEX "ProductExtension_preferredSupplierId_idx" ON "ProductExtension"("preferredSupplierId");
CREATE INDEX "ProductExtension_defaultWarehouseId_idx" ON "ProductExtension"("defaultWarehouseId");
CREATE INDEX "ProductExtension_defaultLocationId_idx" ON "ProductExtension"("defaultLocationId");

ALTER TABLE "UnasProductSnapshot" ADD CONSTRAINT "UnasProductSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductExtension" ADD CONSTRAINT "ProductExtension_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductExtension" ADD CONSTRAINT "ProductExtension_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductExtension" ADD CONSTRAINT "ProductExtension_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductExtension" ADD CONSTRAINT "ProductExtension_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IntegrationCursor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "lastSuccessfulWindowEnd" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnasProductSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "kind" "UnasProductSyncKind" NOT NULL,
    "status" "UnasProductSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "productsSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnasProductSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationCursor_provider_stream_key" ON "IntegrationCursor"("provider", "stream");
CREATE UNIQUE INDEX "UnasProductSyncRun_activeKey_key" ON "UnasProductSyncRun"("activeKey");
CREATE INDEX "UnasProductSyncRun_status_createdAt_idx" ON "UnasProductSyncRun"("status", "createdAt");
CREATE INDEX "UnasProductSyncRun_kind_completedAt_idx" ON "UnasProductSyncRun"("kind", "completedAt");
