-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "customerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_customerId_key" ON "Supplier"("customerId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

