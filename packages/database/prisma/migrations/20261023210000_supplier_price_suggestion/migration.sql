-- CreateEnum
CREATE TYPE "SupplierPriceSuggestionStatus" AS ENUM ('PENDING', 'REJECTED');

-- CreateTable
CREATE TABLE "SupplierPriceSuggestion" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "basis" JSONB NOT NULL,
    "status" "SupplierPriceSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPriceSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPriceSuggestion_supplierId_status_idx" ON "SupplierPriceSuggestion"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierPriceSuggestion_variantId_idx" ON "SupplierPriceSuggestion"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceSuggestion_supplierId_supplierSku_variantId_key" ON "SupplierPriceSuggestion"("supplierId", "supplierSku", "variantId");

-- AddForeignKey
ALTER TABLE "SupplierPriceSuggestion" ADD CONSTRAINT "SupplierPriceSuggestion_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSuggestion" ADD CONSTRAINT "SupplierPriceSuggestion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSuggestion" ADD CONSTRAINT "SupplierPriceSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

