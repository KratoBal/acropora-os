-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "completionCertificateId" TEXT,
ADD COLUMN     "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
ALTER COLUMN "invoiceNumber" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_completionCertificateId_key" ON "Invoice"("completionCertificateId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_completionCertificateId_fkey" FOREIGN KEY ("completionCertificateId") REFERENCES "CompletionCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

