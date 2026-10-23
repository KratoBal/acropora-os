-- Supplier price lists (task beszallitoi-arlistak, card 78f2b6d6), slice 1: the tables the uploaded lists and their product
-- pairing live in. Additive only: three new tables, three enums, indexes and foreign keys. No existing table or column changes,
-- so every existing row is untouched in both directions.
-- ROLLBACK: DROP TABLE "SupplierPriceMatch", "SupplierPriceListEntry", "SupplierPriceList" (in that order: the entry table
-- points at the list), then DROP TYPE "SupplierPriceMatchStatus", "SupplierPriceMatchMethod", "SupplierPriceListFormat".
-- Rows written after this migration are lost with the tables; nothing else reads them yet.

-- CreateEnum
CREATE TYPE "SupplierPriceListFormat" AS ENUM ('DEJONG_STOCKLIST', 'HERTLEIN_ARTIKEL', 'CORALSANDS_PREISLISTE');

-- CreateEnum
CREATE TYPE "SupplierPriceMatchMethod" AS ENUM ('EAN', 'SUPPLIER_CODE', 'NAME');

-- CreateEnum
CREATE TYPE "SupplierPriceMatchStatus" AS ENUM ('AUTO', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SupplierPriceList" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "format" "SupplierPriceListFormat" NOT NULL,
    "listDate" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSha256" VARCHAR(64) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "rejectedRowCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceListEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "supplierName" TEXT,
    "brand" TEXT,
    "gtin" VARCHAR(14),
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "listRetailPrice" DECIMAL(19,4),
    "rowNumber" INTEGER NOT NULL,

    CONSTRAINT "SupplierPriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceMatch" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "method" "SupplierPriceMatchMethod" NOT NULL,
    "status" "SupplierPriceMatchStatus" NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPriceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPriceList_supplierId_listDate_idx" ON "SupplierPriceList"("supplierId", "listDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceList_supplierId_sourceSha256_key" ON "SupplierPriceList"("supplierId", "sourceSha256");

-- CreateIndex
CREATE INDEX "SupplierPriceListEntry_gtin_idx" ON "SupplierPriceListEntry"("gtin");

-- CreateIndex
CREATE INDEX "SupplierPriceListEntry_supplierSku_idx" ON "SupplierPriceListEntry"("supplierSku");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceListEntry_listId_supplierSku_key" ON "SupplierPriceListEntry"("listId", "supplierSku");

-- CreateIndex
CREATE INDEX "SupplierPriceMatch_variantId_idx" ON "SupplierPriceMatch"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceMatch_supplierId_supplierSku_key" ON "SupplierPriceMatch"("supplierId", "supplierSku");

-- AddForeignKey
ALTER TABLE "SupplierPriceList" ADD CONSTRAINT "SupplierPriceList_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceList" ADD CONSTRAINT "SupplierPriceList_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceListEntry" ADD CONSTRAINT "SupplierPriceListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SupplierPriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceMatch" ADD CONSTRAINT "SupplierPriceMatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceMatch" ADD CONSTRAINT "SupplierPriceMatch_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceMatch" ADD CONSTRAINT "SupplierPriceMatch_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraints Prisma cannot express. A new table is empty, so every row will satisfy them from the first insert.
ALTER TABLE "SupplierPriceList" ADD CONSTRAINT "SupplierPriceList_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "SupplierPriceList" ADD CONSTRAINT "SupplierPriceList_sourceSha256_check" CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SupplierPriceList" ADD CONSTRAINT "SupplierPriceList_rowCount_check" CHECK ("rowCount" >= 0 AND "rejectedRowCount" >= 0);
ALTER TABLE "SupplierPriceListEntry" ADD CONSTRAINT "SupplierPriceListEntry_gtin_check" CHECK ("gtin" IS NULL OR "gtin" ~ '^[0-9]{14}$');
ALTER TABLE "SupplierPriceListEntry" ADD CONSTRAINT "SupplierPriceListEntry_unitPrice_check" CHECK ("unitPrice" >= 0 AND ("listRetailPrice" IS NULL OR "listRetailPrice" >= 0));
-- an automatic link needs no decision; a person's approval or rejection must say when it was made
ALTER TABLE "SupplierPriceMatch" ADD CONSTRAINT "SupplierPriceMatch_decided_check" CHECK ("status" = 'AUTO' OR "decidedAt" IS NOT NULL);
