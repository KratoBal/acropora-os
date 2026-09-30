-- Várható beérkezések (Balázs, 2026-09-30): the supplier invoices and proformas
-- that arrive in the info@ mailbox, grouped by order, until they are booked.
-- New tables and enums only: no existing row changes.

-- CreateEnum
CREATE TYPE "ExpectedArrivalStatus" AS ENUM ('OPEN', 'RECEIVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "IncomingSupplierDocumentStatus" AS ENUM ('READ', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "IncomingSupplierDocumentKind" AS ENUM ('INVOICE', 'PROFORMA');

-- CreateEnum
CREATE TYPE "SupplierInvoiceMailSyncRunStatus" AS ENUM ('RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "ExpectedArrival" (
    "id" TEXT NOT NULL,
    "supplierKey" TEXT NOT NULL,
    "arrivalKey" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "orderReference" TEXT,
    "invoiceNumber" TEXT,
    "status" "ExpectedArrivalStatus" NOT NULL DEFAULT 'OPEN',
    "purchaseInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpectedArrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingSupplierDocument" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sender" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3),
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "status" "IncomingSupplierDocumentStatus" NOT NULL,
    "kind" "IncomingSupplierDocumentKind",
    "errorCode" TEXT,
    "importResult" JSONB,
    "lineSuggestions" JSONB,
    "expectedArrivalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingSupplierDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceMailMessage" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "sender" TEXT,
    "receivedAt" TIMESTAMP(3),
    "subject" TEXT,
    "documentCount" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceMailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceMailSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "SupplierInvoiceMailSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "SyncRunTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "documentsRead" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoiceMailSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedArrival_purchaseInvoiceId_key" ON "ExpectedArrival"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "ExpectedArrival_status_updatedAt_idx" ON "ExpectedArrival"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedArrival_supplierKey_arrivalKey_key" ON "ExpectedArrival"("supplierKey", "arrivalKey");

-- CreateIndex
CREATE INDEX "IncomingSupplierDocument_expectedArrivalId_idx" ON "IncomingSupplierDocument"("expectedArrivalId");

-- CreateIndex
CREATE INDEX "IncomingSupplierDocument_sha256_idx" ON "IncomingSupplierDocument"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingSupplierDocument_gmailMessageId_fileName_key" ON "IncomingSupplierDocument"("gmailMessageId", "fileName");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceMailMessage_gmailMessageId_key" ON "SupplierInvoiceMailMessage"("gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceMailSyncRun_activeKey_key" ON "SupplierInvoiceMailSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "SupplierInvoiceMailSyncRun_startedAt_idx" ON "SupplierInvoiceMailSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "ExpectedArrival" ADD CONSTRAINT "ExpectedArrival_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedArrival" ADD CONSTRAINT "ExpectedArrival_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingSupplierDocument" ADD CONSTRAINT "IncomingSupplierDocument_expectedArrivalId_fkey" FOREIGN KEY ("expectedArrivalId") REFERENCES "ExpectedArrival"("id") ON DELETE SET NULL ON UPDATE CASCADE;

