-- CreateEnum
CREATE TYPE "NavInvoiceSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "NavIncomingInvoiceStatus" AS ENUM ('NEW', 'DATA_FETCHED', 'RECEIVED', 'ERROR');

-- CreateTable
CREATE TABLE "NavIncomingInvoice" (
    "id" TEXT NOT NULL,
    "navInvoiceNumber" TEXT NOT NULL,
    "supplierTaxNumber" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "invoiceIssueDate" TIMESTAMP(3) NOT NULL,
    "invoiceDeliveryDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "invoiceNetAmount" DECIMAL(19,2),
    "invoiceVatAmount" DECIMAL(19,2),
    "insDate" TIMESTAMP(3) NOT NULL,
    "status" "NavIncomingInvoiceStatus" NOT NULL DEFAULT 'NEW',
    "parsedData" JSONB,
    "errorCode" TEXT,
    "purchaseInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavIncomingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavInvoiceSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "NavInvoiceSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invoicesSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavInvoiceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NavIncomingInvoice_purchaseInvoiceId_key" ON "NavIncomingInvoice"("purchaseInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "NavIncomingInvoice_navInvoiceNumber_supplierTaxNumber_key" ON "NavIncomingInvoice"("navInvoiceNumber", "supplierTaxNumber");

-- CreateIndex
CREATE INDEX "NavIncomingInvoice_status_insDate_idx" ON "NavIncomingInvoice"("status", "insDate");

-- CreateIndex
CREATE UNIQUE INDEX "NavInvoiceSyncRun_activeKey_key" ON "NavInvoiceSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "NavInvoiceSyncRun_status_createdAt_idx" ON "NavInvoiceSyncRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "NavIncomingInvoice" ADD CONSTRAINT "NavIncomingInvoice_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
