-- CreateTable
CREATE TABLE "ProductDiscontinuation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "replacementProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDiscontinuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDiscontinuation_productId_key" ON "ProductDiscontinuation"("productId");

-- CreateIndex
CREATE INDEX "ProductDiscontinuation_replacementProductId_idx" ON "ProductDiscontinuation"("replacementProductId");

-- AddForeignKey
ALTER TABLE "ProductDiscontinuation" ADD CONSTRAINT "ProductDiscontinuation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiscontinuation" ADD CONSTRAINT "ProductDiscontinuation_replacementProductId_fkey" FOREIGN KEY ("replacementProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
