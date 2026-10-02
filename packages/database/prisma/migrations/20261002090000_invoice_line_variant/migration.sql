-- A számlasor változata (acrobot, kártya 705768fc): több változatú terméknél ez
-- mondja meg, melyik változat készlete csökken. Csak új, NULL-ozható oszlop.
-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "variantId" TEXT;

-- CreateIndex
CREATE INDEX "InvoiceLine_variantId_idx" ON "InvoiceLine"("variantId");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

