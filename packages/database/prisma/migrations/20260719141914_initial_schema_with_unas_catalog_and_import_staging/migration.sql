-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'SALES', 'WAREHOUSE', 'SERVICE', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'SERVICE', 'LIVESTOCK');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'TRANSFER', 'ADJUSTMENT', 'RESERVATION', 'RESERVATION_RELEASE', 'RETURN_IN', 'RETURN_OUT', 'DAMAGE', 'SCRAP', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "StockMovementStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('UNAS', 'POS', 'MANUAL', 'SERVICE', 'API');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceJobStatus" AS ENUM ('NEW', 'TRIAGED', 'SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_CUSTOMER', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AquariumOwnershipType" AS ENUM ('OWN', 'STORE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ExternalSystem" AS ENUM ('UNAS', 'SZAMLAZZ_HU', 'OTHER');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE_ERROR', 'PERMANENT_ERROR');

-- CreateEnum
CREATE TYPE "CatalogChannel" AS ENUM ('UNAS');

-- CreateEnum
CREATE TYPE "ProductRelationType" AS ENUM ('ACCESSORY', 'CROSS_SELL', 'SIMILAR', 'UP_SELL');

-- CreateEnum
CREATE TYPE "CatalogImportProvider" AS ENUM ('UNAS');

-- CreateEnum
CREATE TYPE "CatalogImportStatus" AS ENUM ('STAGED', 'VALIDATED');

-- CreateEnum
CREATE TYPE "CatalogImportEntityType" AS ENUM ('PRODUCT', 'CATEGORY', 'BRAND');

-- CreateEnum
CREATE TYPE "CatalogImportRowStatus" AS ENUM ('VALID', 'INVALID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL',
    "brandId" TEXT,
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'db',
    "vatRate" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelListing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channel" "CatalogChannel" NOT NULL,
    "externalStatus" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "productUrl" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeywords" TEXT,
    "seoRobots" TEXT,
    "backorderAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT,
    "title" TEXT,
    "fileName" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRelation" (
    "id" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "relationType" "ProductRelationType" NOT NULL,
    "sortOrder" INTEGER,

    CONSTRAINT "ProductRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBarcode" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportBatch" (
    "id" TEXT NOT NULL,
    "provider" "CatalogImportProvider" NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "CatalogImportStatus" NOT NULL DEFAULT 'STAGED',
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entityType" "CatalogImportEntityType" NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "externalId" TEXT,
    "sku" TEXT,
    "rawPayload" JSONB NOT NULL,
    "parsedPayload" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "status" "CatalogImportRowStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "supplierName" TEXT,
    "lastPurchaseNet" DECIMAL(19,4),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "lotId" TEXT,
    "onHand" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "movementNumber" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "status" "StockMovementStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceWarehouseId" TEXT,
    "targetWarehouseId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovementLine" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sourceLocationId" TEXT,
    "targetLocationId" TEXT,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "lotId" TEXT,
    "serialNumberId" TEXT,

    CONSTRAINT "StockMovementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "taxNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "marketingEmailConsent" BOOLEAN NOT NULL DEFAULT false,
    "marketingSmsConsent" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL,
    "name" TEXT,
    "country" VARCHAR(2) NOT NULL DEFAULT 'HU',
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "channel" "SalesChannel" NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "totalNet" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalGross" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "orderedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "lineGross" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "expectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "description" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(19,6) NOT NULL,
    "receivedQuantity" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "taxRate" DECIMAL(5,2),
    "expectedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(19,6) NOT NULL,
    "acceptedQuantity" DECIMAL(19,6) NOT NULL,
    "rejectedQuantity" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "unitNet" DECIMAL(19,4),

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJob" (
    "id" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "aquariumId" TEXT,
    "status" "ServiceJobStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedUserId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aquarium" (
    "id" TEXT NOT NULL,
    "aquariumNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "ownershipType" "AquariumOwnershipType" NOT NULL,
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "systemVolumeLiters" DECIMAL(12,3),
    "maintainedByUs" BOOLEAN NOT NULL DEFAULT false,
    "responsibleUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aquarium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AquariumMeasurement" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "value" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "measuredById" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AquariumMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpReport" (
    "id" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "aquariumId" TEXT,
    "laboratoryCode" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "sourceFileUrl" TEXT,
    "sourceFileHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IcpReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpResult" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "elementCode" TEXT NOT NULL,
    "value" DECIMAL(19,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "minimum" DECIMAL(19,8),
    "maximum" DECIMAL(19,8),
    "target" DECIMAL(19,8),
    "trend" TEXT,

    CONSTRAINT "IcpResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "system" "ExternalSystem" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT,
    "metadata" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "correlationId" TEXT,
    "payload" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_type_isActive_idx" ON "Product"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_productId_idx" ON "ProductCategory"("categoryId", "productId");

-- CreateIndex
CREATE INDEX "ProductCategory_productId_isPrimary_idx" ON "ProductCategory"("productId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_productId_categoryId_key" ON "ProductCategory"("productId", "categoryId");

-- CreateIndex
CREATE INDEX "ChannelListing_channel_isPublished_idx" ON "ChannelListing"("channel", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelListing_productId_channel_key" ON "ChannelListing"("productId", "channel");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_url_key" ON "ProductImage"("productId", "url");

-- CreateIndex
CREATE INDEX "ProductRelation_targetProductId_relationType_idx" ON "ProductRelation"("targetProductId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelation_sourceProductId_targetProductId_relationTyp_key" ON "ProductRelation"("sourceProductId", "targetProductId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcode_code_key" ON "ProductBarcode"("code");

-- CreateIndex
CREATE INDEX "ProductBarcode_variantId_idx" ON "ProductBarcode"("variantId");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_provider_createdAt_idx" ON "CatalogImportBatch"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_fileSha256_idx" ON "CatalogImportBatch"("fileSha256");

-- CreateIndex
CREATE INDEX "CatalogImportRow_batchId_status_idx" ON "CatalogImportRow"("batchId", "status");

-- CreateIndex
CREATE INDEX "CatalogImportRow_entityType_externalId_idx" ON "CatalogImportRow"("entityType", "externalId");

-- CreateIndex
CREATE INDEX "CatalogImportRow_entityType_sku_idx" ON "CatalogImportRow"("entityType", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogImportRow_batchId_entityType_sourceRowNumber_key" ON "CatalogImportRow"("batchId", "entityType", "sourceRowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_supplierSku_key" ON "SupplierProduct"("supplierId", "supplierSku");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_variantId_key" ON "SupplierProduct"("supplierId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "StockItem_warehouseId_variantId_idx" ON "StockItem"("warehouseId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_variantId_warehouseId_locationId_lotId_key" ON "StockItem"("variantId", "warehouseId", "locationId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_movementNumber_key" ON "StockMovement"("movementNumber");

-- CreateIndex
CREATE INDEX "StockMovement_status_occurredAt_idx" ON "StockMovement"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockMovementLine_variantId_idx" ON "StockMovementLine"("variantId");

-- CreateIndex
CREATE INDEX "StockMovementLine_movementId_idx" ON "StockMovementLine"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNumber_key" ON "Customer"("customerNumber");

-- CreateIndex
CREATE INDEX "Customer_displayName_idx" ON "Customer"("displayName");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_type_idx" ON "CustomerAddress"("customerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNumber_key" ON "SalesOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "SalesOrder_status_createdAt_idx" ON "SalesOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_createdAt_idx" ON "SalesOrder"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrderLine_orderId_idx" ON "SalesOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_variantId_idx" ON "SalesOrderLine"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNumber_key" ON "PurchaseOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_warehouseId_expectedAt_idx" ON "PurchaseOrder"("warehouseId", "expectedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_variantId_idx" ON "PurchaseOrderLine"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_receiptNumber_key" ON "GoodsReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_receivedAt_idx" ON "GoodsReceipt"("purchaseOrderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_goodsReceiptId_purchaseOrderLineId_key" ON "GoodsReceiptLine"("goodsReceiptId", "purchaseOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_jobNumber_key" ON "ServiceJob"("jobNumber");

-- CreateIndex
CREATE INDEX "ServiceJob_status_scheduledAt_idx" ON "ServiceJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ServiceJob_customerId_idx" ON "ServiceJob"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Aquarium_aquariumNumber_key" ON "Aquarium"("aquariumNumber");

-- CreateIndex
CREATE INDEX "Aquarium_customerId_isActive_idx" ON "Aquarium"("customerId", "isActive");

-- CreateIndex
CREATE INDEX "AquariumMeasurement_aquariumId_parameterCode_measuredAt_idx" ON "AquariumMeasurement"("aquariumId", "parameterCode", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "IcpReport_reportNumber_key" ON "IcpReport"("reportNumber");

-- CreateIndex
CREATE INDEX "IcpReport_aquariumId_reportedAt_idx" ON "IcpReport"("aquariumId", "reportedAt");

-- CreateIndex
CREATE INDEX "IcpReport_laboratoryCode_reportedAt_idx" ON "IcpReport"("laboratoryCode", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IcpResult_reportId_elementCode_key" ON "IcpResult"("reportId", "elementCode");

-- CreateIndex
CREATE INDEX "ExternalReference_entityType_entityId_idx" ON "ExternalReference"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReference_system_entityType_externalId_key" ON "ExternalReference"("system", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReference_system_entityType_entityId_key" ON "ExternalReference"("system", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSyncState_idempotencyKey_key" ON "IntegrationSyncState"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationSyncState_status_nextAttemptAt_idx" ON "IntegrationSyncState"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "DomainEvent_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_publishedAt_occurredAt_idx" ON "DomainEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_correlationId_idx" ON "DomainEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aquarium" ADD CONSTRAINT "Aquarium_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurement" ADD CONSTRAINT "AquariumMeasurement_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpResult" ADD CONSTRAINT "IcpResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "IcpReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
