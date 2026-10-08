-- #1582 P7: a quote payment milestone's proforma draft. A nullable column:
-- no existing row is affected. Restrict: a proforma prepared from a
-- milestone is not deleted from under it.

-- AlterTable
ALTER TABLE "QuotePaymentMilestone" ADD COLUMN     "proformaInvoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QuotePaymentMilestone_proformaInvoiceId_key" ON "QuotePaymentMilestone"("proformaInvoiceId");

-- AddForeignKey
ALTER TABLE "QuotePaymentMilestone" ADD CONSTRAINT "QuotePaymentMilestone_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

