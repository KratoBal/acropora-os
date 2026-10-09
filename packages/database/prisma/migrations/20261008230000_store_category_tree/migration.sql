-- SEO P0 PR 10 (C6): az Acropora-kategoriafa. Harom uj tabla, a regi Category es
-- ProductCategory valtozatlan. A tablak uresen indulnak: a fat a
-- `store-category:load` CLI tolti.

-- CreateTable
CREATE TABLE "StoreCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "intro" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCategoryProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeCategoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCategoryProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnasCategoryMapping" (
    "id" TEXT NOT NULL,
    "unasCategoryId" TEXT NOT NULL,
    "storeCategoryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnasCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreCategory_slug_key" ON "StoreCategory"("slug");

-- CreateIndex
CREATE INDEX "StoreCategory_parentId_idx" ON "StoreCategory"("parentId");

-- CreateIndex
CREATE INDEX "StoreCategoryProduct_storeCategoryId_productId_idx" ON "StoreCategoryProduct"("storeCategoryId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCategoryProduct_productId_storeCategoryId_key" ON "StoreCategoryProduct"("productId", "storeCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UnasCategoryMapping_unasCategoryId_key" ON "UnasCategoryMapping"("unasCategoryId");

-- CreateIndex
CREATE INDEX "UnasCategoryMapping_storeCategoryId_idx" ON "UnasCategoryMapping"("storeCategoryId");

-- AddForeignKey
ALTER TABLE "StoreCategory" ADD CONSTRAINT "StoreCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StoreCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCategoryProduct" ADD CONSTRAINT "StoreCategoryProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCategoryProduct" ADD CONSTRAINT "StoreCategoryProduct_storeCategoryId_fkey" FOREIGN KEY ("storeCategoryId") REFERENCES "StoreCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnasCategoryMapping" ADD CONSTRAINT "UnasCategoryMapping_unasCategoryId_fkey" FOREIGN KEY ("unasCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnasCategoryMapping" ADD CONSTRAINT "UnasCategoryMapping_storeCategoryId_fkey" FOREIGN KEY ("storeCategoryId") REFERENCES "StoreCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex (reszleges, a Prisma semaban nem leirhato): termekenkent legfeljebb
-- EGY primary Acropora-kategoria. A morzsa es a `primary_category_id` ebbol jon,
-- tehat ket primary ket kulonbozo morzsat adhatna ugyanannak a termeknek.
CREATE UNIQUE INDEX "StoreCategoryProduct_productId_primary_key" ON "StoreCategoryProduct"("productId") WHERE "isPrimary";
