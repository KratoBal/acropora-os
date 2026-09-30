-- SimplePay elszámolás (Balázs, 2026-09-30 12:07 UTC): a heti kimutatás és
-- a tranzakciói, a webshop-rendeléshez és a kimenő számlájához kötve.
-- Csak új felsorolások és két új tábla; meglévő táblát és sort nem érint.

-- CreateEnum
CREATE TYPE "SimplePayReportStatus" AS ENUM ('COMPLETED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SimplePayLineStatus" AS ENUM ('RESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SimplePayResolutionSource" AS ENUM ('ORDER_KEY', 'MANUAL');

-- CreateTable
CREATE TABLE "SimplePayReport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "contentKey" TEXT NOT NULL,
    "reportDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "amountTotal" DECIMAL(19,4) NOT NULL,
    "commissionTotal" DECIMAL(19,4) NOT NULL,
    "netTotal" DECIMAL(19,4) NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "warnings" TEXT[],
    "status" "SimplePayReportStatus" NOT NULL,
    "gmailMessageId" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimplePayReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimplePayTransactionLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "transactionStatus" TEXT NOT NULL,
    "simplePayTransactionId" TEXT NOT NULL,
    "merchantTransactionId" TEXT NOT NULL,
    "orderKeySuffix" TEXT,
    "transactionAt" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "amount" DECIMAL(19,4) NOT NULL,
    "commission" DECIMAL(19,4) NOT NULL,
    "netAmount" DECIMAL(19,4) NOT NULL,
    "interchangeFee" DECIMAL(19,4),
    "schemeFee" DECIMAL(19,4),
    "merchantFee" DECIMAL(19,4),
    "orderNumber" TEXT,
    "orderTotal" DECIMAL(19,4),
    "invoiceNumbers" TEXT[],
    "status" "SimplePayLineStatus" NOT NULL,
    "resolutionSource" "SimplePayResolutionSource",
    "errorCode" TEXT,
    "manualApprovedByUserId" TEXT,
    "manualApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimplePayTransactionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayReport_sha256_key" ON "SimplePayReport"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayReport_contentKey_key" ON "SimplePayReport"("contentKey");

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayReport_gmailMessageId_key" ON "SimplePayReport"("gmailMessageId");

-- CreateIndex
CREATE INDEX "SimplePayReport_reportDate_idx" ON "SimplePayReport"("reportDate");

-- CreateIndex
CREATE INDEX "SimplePayReport_status_idx" ON "SimplePayReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayTransactionLine_simplePayTransactionId_key" ON "SimplePayTransactionLine"("simplePayTransactionId");

-- CreateIndex
CREATE INDEX "SimplePayTransactionLine_orderKeySuffix_idx" ON "SimplePayTransactionLine"("orderKeySuffix");

-- CreateIndex
CREATE INDEX "SimplePayTransactionLine_status_idx" ON "SimplePayTransactionLine"("status");

-- CreateIndex
CREATE INDEX "SimplePayTransactionLine_transactionDate_idx" ON "SimplePayTransactionLine"("transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayTransactionLine_reportId_rowNumber_key" ON "SimplePayTransactionLine"("reportId", "rowNumber");

-- AddForeignKey
ALTER TABLE "SimplePayTransactionLine" ADD CONSTRAINT "SimplePayTransactionLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SimplePayReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimplePayTransactionLine" ADD CONSTRAINT "SimplePayTransactionLine_manualApprovedByUserId_fkey" FOREIGN KEY ("manualApprovedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

