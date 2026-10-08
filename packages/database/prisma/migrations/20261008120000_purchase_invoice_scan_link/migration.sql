-- Card 5ec62e35 (Luca): a scanned invoice attached to a recorded purchase
-- invoice, as an IncomingSupplierDocument (origin UPLOAD) with a direct link.
-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "purchaseInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "IncomingSupplierDocument_purchaseInvoiceId_idx" ON "IncomingSupplierDocument"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "IncomingSupplierDocument" ADD CONSTRAINT "IncomingSupplierDocument_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

