-- Számlázás v0.1: a négy bizonylattípus domainje (capability report 5. és
-- 6.1-6.4 pont, 2026-09-30; Balázs döntése a kedvezményről: külön negatív
-- sor, message_id 1554830166734143498).
--
-- A meglévő `Invoice` tábla marad a billing dokumentum: ugyanez viszi a
-- karbantartási számlát, a bejövő számlákat és a UNAS-tükröt. Ezért minden
-- változás ADDITÍV:
--   - két felsorolás kap új értéket (DELIVERY_NOTE, ISSUE_FAILED), amit ma
--     egyetlen sor sem visel, és a migráció DML-ben nem használja, tehát az
--     `ALTER TYPE ... ADD VALUE` a tranzakcióban biztonságos;
--   - minden új oszlop NULL-ozható, kivéve a `kind` (DEFAULT 'ITEM') és az
--     `issueAttemptCount` (DEFAULT 0): ezek alapértéke a régi sorokra IGAZ,
--     hiszen minden eddigi sor tétel, és egyik sem indított kiállítást a
--     számláló bevezetése óta;
--   - egy új tábla (BillingDocumentMailDelivery).
-- Egyetlen meglévő sort sem ír át.

-- CreateEnum
CREATE TYPE "InvoiceFormat" AS ENUM ('PAPER', 'ELECTRONIC');

-- CreateEnum
CREATE TYPE "BillingEmailStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingSourceType" AS ENUM ('PROJECT', 'SALES_ORDER', 'POS_TRANSACTION', 'SERVICE_JOB', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('ITEM', 'DISCOUNT');

-- AlterEnum
ALTER TYPE "InvoiceDocumentType" ADD VALUE 'DELIVERY_NOTE';

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUE_FAILED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "emailStatus" "BillingEmailStatus",
ADD COLUMN     "invoiceFormat" "InvoiceFormat",
ADD COLUMN     "issueAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "language" VARCHAR(2),
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "proformaInvoiceId" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" "BillingSourceType";

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "discountPercent" DECIMAL(5,2),
ADD COLUMN     "kind" "InvoiceLineKind" NOT NULL DEFAULT 'ITEM',
ADD COLUMN     "parentLineId" TEXT,
ADD COLUMN     "position" INTEGER,
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "BillingDocumentMailDelivery" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "templateId" TEXT,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingDocumentMailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingDocumentMailDelivery_invoiceId_createdAt_idx" ON "BillingDocumentMailDelivery"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_sourceType_sourceId_idx" ON "Invoice"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Invoice_proformaInvoiceId_idx" ON "Invoice"("proformaInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_parentLineId_idx" ON "InvoiceLine"("parentLineId");

-- CreateIndex
CREATE INDEX "InvoiceLine_productId_idx" ON "InvoiceLine"("productId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_parentLineId_fkey" FOREIGN KEY ("parentLineId") REFERENCES "InvoiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentMailDelivery" ADD CONSTRAINT "BillingDocumentMailDelivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentMailDelivery" ADD CONSTRAINT "BillingDocumentMailDelivery_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

