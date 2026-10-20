-- The products shown in the home page's "Egyedi korallok" band (per-product marker).
-- CreateTable
CREATE TABLE "HomepageFeaturedProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageFeaturedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomepageFeaturedProduct_productId_key" ON "HomepageFeaturedProduct"("productId");

-- CreateIndex
CREATE INDEX "HomepageFeaturedProduct_sortOrder_idx" ON "HomepageFeaturedProduct"("sortOrder");

-- AddForeignKey
ALTER TABLE "HomepageFeaturedProduct" ADD CONSTRAINT "HomepageFeaturedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
