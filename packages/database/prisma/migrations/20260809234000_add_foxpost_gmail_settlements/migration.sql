-- CreateEnum
CREATE TYPE "FoxpostSettlementStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'ERROR');

-- CreateEnum
CREATE TYPE "FoxpostSettlementLineStatus" AS ENUM ('MATCHED', 'ORDER_NOT_FOUND', 'INVOICE_NOT_FOUND');

-- CreateEnum
CREATE TYPE "FoxpostResolutionSource" AS ENUM ('LOCAL', 'UNAS');

-- CreateEnum
CREATE TYPE "FoxpostSyncRunStatus" AS ENUM ('RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "FoxpostSettlement" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "gmailInternalDate" TIMESTAMP(3),
    "gmailSubject" TEXT,
    "gmailFrom" TEXT,
    "xlsxAttachmentId" TEXT NOT NULL,
    "xlsxFileName" TEXT NOT NULL,
    "xlsxContent" BYTEA NOT NULL,
    "xlsxSha256" TEXT NOT NULL,
    "pdfAttachmentId" TEXT NOT NULL,
    "pdfFileName" TEXT NOT NULL,
    "pdfContent" BYTEA NOT NULL,
    "pdfSha256" TEXT NOT NULL,
    "partnerCode" TEXT,
    "settlementCode" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "invoiceNumber" TEXT,
    "invoiceIssueDate" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "collectedAmount" DECIMAL(19,4),
    "invoiceGrossAmount" DECIMAL(19,4),
    "transferredAmount" DECIMAL(19,4),
    "status" "FoxpostSettlementStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoxpostSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoxpostSettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "recipientName" TEXT,
    "parcelBarcode" TEXT,
    "collectedAmount" DECIMAL(19,4) NOT NULL,
    "salesOrderId" TEXT,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT,
    "resolutionSource" "FoxpostResolutionSource",
    "status" "FoxpostSettlementLineStatus" NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoxpostSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoxpostMonthlyReport" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "settlementCount" INTEGER NOT NULL,
    "invoiceCount" INTEGER NOT NULL,
    "collectedAmount" DECIMAL(19,4) NOT NULL,
    "invoiceGrossAmount" DECIMAL(19,4) NOT NULL,
    "transferredAmount" DECIMAL(19,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoxpostMonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoxpostSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "FoxpostSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "needsReviewCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoxpostSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoxpostSettlement_gmailMessageId_key" ON "FoxpostSettlement"("gmailMessageId");
CREATE UNIQUE INDEX "FoxpostSettlement_xlsxSha256_key" ON "FoxpostSettlement"("xlsxSha256");
CREATE UNIQUE INDEX "FoxpostSettlement_pdfSha256_key" ON "FoxpostSettlement"("pdfSha256");
CREATE UNIQUE INDEX "FoxpostSettlement_invoiceNumber_key" ON "FoxpostSettlement"("invoiceNumber");
CREATE UNIQUE INDEX "FoxpostSettlement_partnerCode_settlementCode_key" ON "FoxpostSettlement"("partnerCode", "settlementCode");
CREATE INDEX "FoxpostSettlement_status_createdAt_idx" ON "FoxpostSettlement"("status", "createdAt");
CREATE INDEX "FoxpostSettlement_invoiceIssueDate_idx" ON "FoxpostSettlement"("invoiceIssueDate");
CREATE UNIQUE INDEX "FoxpostSettlementLine_settlementId_sourceRowNumber_key" ON "FoxpostSettlementLine"("settlementId", "sourceRowNumber");
CREATE INDEX "FoxpostSettlementLine_referenceCode_idx" ON "FoxpostSettlementLine"("referenceCode");
CREATE INDEX "FoxpostSettlementLine_status_idx" ON "FoxpostSettlementLine"("status");
CREATE INDEX "FoxpostSettlementLine_salesOrderId_idx" ON "FoxpostSettlementLine"("salesOrderId");
CREATE INDEX "FoxpostSettlementLine_invoiceId_idx" ON "FoxpostSettlementLine"("invoiceId");
CREATE UNIQUE INDEX "FoxpostMonthlyReport_year_month_key" ON "FoxpostMonthlyReport"("year", "month");
CREATE INDEX "FoxpostMonthlyReport_year_month_idx" ON "FoxpostMonthlyReport"("year", "month");
CREATE UNIQUE INDEX "FoxpostSyncRun_activeKey_key" ON "FoxpostSyncRun"("activeKey");
CREATE INDEX "FoxpostSyncRun_status_createdAt_idx" ON "FoxpostSyncRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FoxpostSettlementLine" ADD CONSTRAINT "FoxpostSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "FoxpostSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FoxpostSettlementLine" ADD CONSTRAINT "FoxpostSettlementLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FoxpostSettlementLine" ADD CONSTRAINT "FoxpostSettlementLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
