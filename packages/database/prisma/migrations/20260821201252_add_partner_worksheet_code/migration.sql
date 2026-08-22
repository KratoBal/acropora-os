-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "worksheetPartnerCode" VARCHAR(4);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_worksheetPartnerCode_key" ON "Supplier"("worksheetPartnerCode");

