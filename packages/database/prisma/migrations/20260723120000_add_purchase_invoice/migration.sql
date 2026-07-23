-- CreateEnum
CREATE TYPE "PurchaseInvoiceSource" AS ENUM ('EU', 'HU_MANUAL', 'HU_NAV');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Supplier"
    ADD COLUMN "taxNumber" TEXT,
    ADD COLUMN "country" VARCHAR(2) NOT NULL DEFAULT 'HU',
    ADD COLUMN "email" TEXT,
    ADD COLUMN "phone" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_country_isActive_idx" ON "Supplier"("country", "isActive");

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "source" "PurchaseInvoiceSource" NOT NULL,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'POSTED',
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "exchangeRate" DECIMAL(19,6),
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "vatRate" DECIMAL(5,2),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceLine" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sourceDescription" TEXT,
    "orderedQuantity" DECIMAL(19,6) NOT NULL,
    "actualQuantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,

    CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_documentNumber_key" ON "PurchaseInvoice"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_supplierId_supplierInvoiceNumber_key" ON "PurchaseInvoice"("supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_invoiceDate_idx" ON "PurchaseInvoice"("status", "invoiceDate");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_warehouseId_idx" ON "PurchaseInvoice"("warehouseId");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_purchaseInvoiceId_idx" ON "PurchaseInvoiceLine"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_variantId_idx" ON "PurchaseInvoiceLine"("variantId");

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
