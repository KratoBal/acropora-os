-- CreateEnum
CREATE TYPE "GlsCodReportStatus" AS ENUM ('COMPLETED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "GlsCodLineStatus" AS ENUM ('RESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "GlsCodResolutionSource" AS ENUM ('INVOICE_NUMBER', 'ORDER_KEY', 'MANUAL');

-- CreateTable
CREATE TABLE "GlsCodReport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "contentKey" TEXT NOT NULL,
    "transferDate" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "total" DECIMAL(19,4) NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "status" "GlsCodReportStatus" NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsCodReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlsCodReportLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "reportNumber" TEXT,
    "parcelNumber" TEXT NOT NULL,
    "codReference" TEXT,
    "deliveryDate" DATE,
    "amount" DECIMAL(19,4) NOT NULL,
    "invoiceNumbers" TEXT[],
    "status" "GlsCodLineStatus" NOT NULL,
    "resolutionSource" "GlsCodResolutionSource",
    "errorCode" TEXT,
    "suggestedInvoiceNumber" TEXT,
    "manualApprovedByUserId" TEXT,
    "manualApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsCodReportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlsInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "feeTotal" DECIMAL(19,4) NOT NULL,
    "cardFeeTotal" DECIMAL(19,4) NOT NULL,
    "parcelCount" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlsInvoiceParcel" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "parcelNumber" TEXT NOT NULL,
    "clientReference" TEXT,
    "codReference" TEXT,
    "pickupDate" DATE,
    "deliveryDate" DATE,
    "fee" DECIMAL(19,4) NOT NULL,
    "codValue" DECIMAL(19,4),
    "codFee" DECIMAL(19,4),
    "cardFee" DECIMAL(19,4),

    CONSTRAINT "GlsInvoiceParcel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlsCodReport_sha256_key" ON "GlsCodReport"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "GlsCodReport_contentKey_key" ON "GlsCodReport"("contentKey");

-- CreateIndex
CREATE INDEX "GlsCodReport_transferDate_idx" ON "GlsCodReport"("transferDate");

-- CreateIndex
CREATE INDEX "GlsCodReport_status_idx" ON "GlsCodReport"("status");

-- CreateIndex
CREATE INDEX "GlsCodReportLine_parcelNumber_idx" ON "GlsCodReportLine"("parcelNumber");

-- CreateIndex
CREATE INDEX "GlsCodReportLine_status_idx" ON "GlsCodReportLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GlsCodReportLine_reportId_rowNumber_key" ON "GlsCodReportLine"("reportId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GlsInvoice_invoiceNumber_key" ON "GlsInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GlsInvoice_sha256_key" ON "GlsInvoice"("sha256");

-- CreateIndex
CREATE INDEX "GlsInvoice_invoiceDate_idx" ON "GlsInvoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "GlsInvoiceParcel_parcelNumber_idx" ON "GlsInvoiceParcel"("parcelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GlsInvoiceParcel_invoiceId_parcelNumber_key" ON "GlsInvoiceParcel"("invoiceId", "parcelNumber");

-- AddForeignKey
ALTER TABLE "GlsCodReportLine" ADD CONSTRAINT "GlsCodReportLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "GlsCodReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlsCodReportLine" ADD CONSTRAINT "GlsCodReportLine_manualApprovedByUserId_fkey" FOREIGN KEY ("manualApprovedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlsInvoiceParcel" ADD CONSTRAINT "GlsInvoiceParcel_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "GlsInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

