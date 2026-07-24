-- CreateEnum
CREATE TYPE "SzamlazzCredentialMode" AS ENUM ('ENV_FALLBACK', 'DATABASE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SzamlazzVerificationStatus" AS ENUM ('NEVER', 'SUCCESS', 'FAILED', 'INDETERMINATE');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "InvoiceDocumentType" AS ENUM ('INVOICE', 'ADVANCE_INVOICE', 'FINAL_INVOICE', 'STORNO', 'CORRECTION', 'PROFORMA');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('SZAMLAZZ', 'NAV', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "InvoiceSyncStatus" AS ENUM ('PENDING', 'RECEIVED', 'ERROR');

-- CreateTable
CREATE TABLE "SzamlazzConnectionSetting" (
    "id" TEXT NOT NULL,
    "credentialMode" "SzamlazzCredentialMode" NOT NULL DEFAULT 'ENV_FALLBACK',
    "encryptedAgentKey" BYTEA,
    "agentKeyEncryptionIv" BYTEA,
    "agentKeyAuthenticationTag" BYTEA,
    "agentKeyVersion" TEXT,
    "encryptedFinancialApiKey" BYTEA,
    "financialApiKeyEncryptionIv" BYTEA,
    "financialApiKeyAuthenticationTag" BYTEA,
    "financialApiKeyVersion" TEXT,
    "credentialRevision" INTEGER NOT NULL DEFAULT 0,
    "credentialUpdatedAt" TIMESTAMP(3),
    "credentialUpdatedByUserId" TEXT,
    "verificationStatus" "SzamlazzVerificationStatus" NOT NULL DEFAULT 'NEVER',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationCode" TEXT,
    "credentialAttemptedAt" TIMESTAMP(3),
    "testAttemptedAt" TIMESTAMP(3),
    "backfillStartDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SzamlazzConnectionSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "documentType" "InvoiceDocumentType" NOT NULL DEFAULT 'INVOICE',
    "source" "InvoiceSource" NOT NULL,
    "szamlazzInvoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "partnerTaxNumber" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "fulfillmentDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "exchangeRate" DECIMAL(19,6),
    "netAmount" DECIMAL(19,4) NOT NULL,
    "vatAmount" DECIMAL(19,4) NOT NULL,
    "grossAmount" DECIMAL(19,4) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "referencedInvoiceId" TEXT,
    "syncStatus" "InvoiceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,
    "rawPayloadStorageKey" TEXT,
    "pdfStorageKey" TEXT,
    "bookkeepingStatus" TEXT,
    "tags" TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "netAmount" DECIMAL(19,4) NOT NULL,
    "vatAmount" DECIMAL(19,4) NOT NULL,
    "grossAmount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SzamlazzConnectionSetting_credentialUpdatedByUserId_idx" ON "SzamlazzConnectionSetting"("credentialUpdatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_source_szamlazzInvoiceId_key" ON "Invoice"("source", "szamlazzInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_direction_issueDate_idx" ON "Invoice"("direction", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_partnerTaxNumber_idx" ON "Invoice"("partnerTaxNumber");

-- CreateIndex
CREATE INDEX "Invoice_syncStatus_idx" ON "Invoice"("syncStatus");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "SzamlazzConnectionSetting" ADD CONSTRAINT "SzamlazzConnectionSetting_credentialUpdatedByUserId_fkey" FOREIGN KEY ("credentialUpdatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_referencedInvoiceId_fkey" FOREIGN KEY ("referencedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
