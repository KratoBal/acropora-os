-- Minimal project registry for purchase-invoice project allocation.
CREATE TYPE "ProjectStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "ProjectInventoryReservationStatus" AS ENUM (
  'ACTIVE',
  'RELEASED',
  'CONSUMED'
);

-- Human-readable project numbers are generated safely under concurrency.
CREATE SEQUENCE "ProjectNumberSequence"
  AS BIGINT
  INCREMENT BY 1
  MINVALUE 1
  START WITH 1
  CACHE 1;

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "projectNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "customerId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectInventoryReservation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "purchaseInvoiceLineId" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" DECIMAL(19,6) NOT NULL,
  "status" "ProjectInventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "releasedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectInventoryReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectInventoryReservation_positive_quantity"
    CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "Project_projectNumber_key"
ON "Project"("projectNumber");

CREATE INDEX "Project_status_name_idx"
ON "Project"("status", "name");

CREATE INDEX "Project_customerId_idx"
ON "Project"("customerId");

CREATE INDEX "Project_createdById_idx"
ON "Project"("createdById");

CREATE UNIQUE INDEX "ProjectInventoryReservation_purchaseInvoiceLineId_projectId_key"
ON "ProjectInventoryReservation"("purchaseInvoiceLineId", "projectId");

CREATE INDEX "ProjectInventoryReservation_projectId_status_idx"
ON "ProjectInventoryReservation"("projectId", "status");

CREATE INDEX "ProjectInventoryReservation_stockItemId_status_idx"
ON "ProjectInventoryReservation"("stockItemId", "status");

CREATE INDEX "ProjectInventoryReservation_variantId_warehouseId_status_idx"
ON "ProjectInventoryReservation"("variantId", "warehouseId", "status");

ALTER TABLE "Project"
ADD CONSTRAINT "Project_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Project"
ADD CONSTRAINT "Project_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_purchaseInvoiceLineId_fkey"
FOREIGN KEY ("purchaseInvoiceLineId") REFERENCES "PurchaseInvoiceLine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_stockItemId_fkey"
FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectInventoryReservation"
ADD CONSTRAINT "ProjectInventoryReservation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
