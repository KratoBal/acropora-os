-- SEO P0 PR 2: AZ ATTRIBUTUM-MODELL (terv: exchange/seo/seo-p0-terv-2026-10-07.md,
-- C1 es "PR 2", a tiz kiegeszito dontessel).
--
-- Negy uj tabla (AttributeDefinition, AttributeEnumValue, AttributeSet,
-- AttributeSetAttribute) es egy nullable oszlop (Product.attributeSetId). A DDL
-- betura az, amit a `prisma migrate diff` a main sémájából ide ir.
--
-- A SEED ITT ALL, A MIGRACIOBAN, NEM EGY KULON LEPESBEN: a vetites `public`-kapuja
-- a definiciokat olvassa, es egy ures tabla mellett MINDEN tenyt elvenne a
-- vevotol. A 25 sor az `apps/api/src/products/attributes/attribute-definitions.ts`
-- `seedSql()`-jebol irodott; a teszt orzi, hogy a ketto egyezik. Mind `public`:
-- ma minden VERIFIED teny kimegy, tehat a kapu egyet sem vehet el.
-- `ON CONFLICT DO NOTHING`: ujrafuttatva sem ir felul egy kesobb modositott sort.
--
-- Visszaallitas: a tablakra semmi nem hivatkozik a `Product.attributeSetId`-n
-- kivul (SET NULL); a down a tablak es az oszlop eldobasa.

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('STRING', 'TEXT', 'NUMBER', 'BOOLEAN', 'ENUM', 'RANGE', 'QUANTITY', 'RELATION', 'DOSE');

-- CreateEnum
CREATE TYPE "AttributeDimension" AS ENUM ('LENGTH', 'MASS', 'VOLUME', 'FLOW', 'POWER', 'VOLTAGE', 'DOSE', 'TEMPERATURE', 'CONCENTRATION');

-- CreateEnum
CREATE TYPE "AttributeRelationTarget" AS ENUM ('PRODUCT', 'BRAND', 'STORE_CATEGORY');

-- CreateEnum
CREATE TYPE "AttributeScope" AS ENUM ('PRODUCT', 'VARIANT');

-- CreateEnum
CREATE TYPE "AttributeStorage" AS ENUM ('KNOWLEDGE_FACT', 'VARIANT_BARCODE', 'IMAGE_ALT');

-- CreateEnum
CREATE TYPE "AttributeTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "AttributeClaimPolicy" AS ENUM ('NONE', 'VALUE', 'PROSE');

-- CreateEnum
CREATE TYPE "AttributeMedusaNativeField" AS ENUM ('VARIANT_WEIGHT', 'VARIANT_LENGTH', 'VARIANT_WIDTH', 'VARIANT_HEIGHT', 'VARIANT_ORIGIN_COUNTRY');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributeSetId" TEXT;

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "key" VARCHAR(48) NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" "AttributeDataType" NOT NULL,
    "dimension" "AttributeDimension",
    "canonicalUnit" TEXT,
    "relationTarget" "AttributeRelationTarget",
    "scope" "AttributeScope" NOT NULL DEFAULT 'PRODUCT',
    "storage" "AttributeStorage" NOT NULL DEFAULT 'KNOWLEDGE_FACT',
    "tier" "AttributeTier" NOT NULL,
    "claimPolicy" "AttributeClaimPolicy" NOT NULL DEFAULT 'NONE',
    "validation" JSONB,
    "searchable" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "aiVisible" BOOLEAN NOT NULL DEFAULT false,
    "merchantVisible" BOOLEAN NOT NULL DEFAULT false,
    "medusaNativeField" "AttributeMedusaNativeField",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AttributeEnumValue" (
    "id" TEXT NOT NULL,
    "attributeKey" VARCHAR(48) NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttributeEnumValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeSetAttribute" (
    "id" TEXT NOT NULL,
    "attributeSetId" TEXT NOT NULL,
    "attributeKey" VARCHAR(48) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN,
    "group" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttributeSetAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttributeEnumValue_attributeKey_value_key" ON "AttributeEnumValue"("attributeKey", "value");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeSet_key_key" ON "AttributeSet"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeSetAttribute_attributeSetId_attributeKey_key" ON "AttributeSetAttribute"("attributeSetId", "attributeKey");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_attributeSetId_fkey" FOREIGN KEY ("attributeSetId") REFERENCES "AttributeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeEnumValue" ADD CONSTRAINT "AttributeEnumValue_attributeKey_fkey" FOREIGN KEY ("attributeKey") REFERENCES "AttributeDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeSet" ADD CONSTRAINT "AttributeSet_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AttributeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeSetAttribute" ADD CONSTRAINT "AttributeSetAttribute_attributeSetId_fkey" FOREIGN KEY ("attributeSetId") REFERENCES "AttributeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeSetAttribute" ADD CONSTRAINT "AttributeSetAttribute_attributeKey_fkey" FOREIGN KEY ("attributeKey") REFERENCES "AttributeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed: a 25 teny-kulcs definicioja (attribute-definitions.ts seedSql())
INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES
('compatibility', 'Kompatibilitás', 'TEXT', NULL, NULL, 'PRODUCT', 'B', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('application', 'Felhasználás', 'TEXT', NULL, NULL, 'PRODUCT', 'B', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('dosingText', 'Adagolás', 'TEXT', NULL, NULL, 'PRODUCT', 'B', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('productFamily', 'Termékcsalád', 'TEXT', NULL, NULL, 'PRODUCT', 'B', 'NONE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('ean', 'EAN', 'STRING', NULL, NULL, 'PRODUCT', 'C', 'VALUE', '{"pattern":"^(\\d{8}|\\d{12,14})$"}'::jsonb, true, false, false, NULL, CURRENT_TIMESTAMP),
('manufacturerSku', 'Gyártói cikkszám', 'STRING', NULL, NULL, 'PRODUCT', 'C', 'VALUE', '{"maxLength":64}'::jsonb, true, false, false, NULL, CURRENT_TIMESTAMP),
('lengthMm', 'Hosszúság', 'QUANTITY', 'LENGTH', 'mm', 'VARIANT', 'C', 'VALUE', NULL, true, false, false, 'VARIANT_LENGTH', CURRENT_TIMESTAMP),
('widthMm', 'Szélesség', 'QUANTITY', 'LENGTH', 'mm', 'VARIANT', 'C', 'VALUE', NULL, true, false, false, 'VARIANT_WIDTH', CURRENT_TIMESTAMP),
('heightMm', 'Magasság', 'QUANTITY', 'LENGTH', 'mm', 'VARIANT', 'C', 'VALUE', NULL, true, false, false, 'VARIANT_HEIGHT', CURRENT_TIMESTAMP),
('volume', 'Űrtartalom', 'QUANTITY', 'VOLUME', 'ml', 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('weight', 'Tömeg', 'QUANTITY', 'MASS', 'g', 'VARIANT', 'C', 'VALUE', NULL, true, false, false, 'VARIANT_WEIGHT', CURRENT_TIMESTAMP),
('flowRate', 'Áramlás', 'QUANTITY', 'FLOW', 'l/h', 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('power', 'Teljesítményfelvétel', 'QUANTITY', 'POWER', 'W', 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('voltage', 'Feszültség', 'QUANTITY', 'VOLTAGE', 'V', 'PRODUCT', 'C', 'VALUE', '{"unitQualifiers":["AC","DC"]}'::jsonb, true, false, false, NULL, CURRENT_TIMESTAMP),
('dosingAmount', 'Adagolási mennyiség', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('composition', 'Összetétel', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('warranty', 'Garancia', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('safetyInformation', 'Biztonsági adatok', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('brand', 'Márka', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('capacity', 'Kapacitás', 'QUANTITY', 'VOLUME', 'ml', 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('packSize', 'Kiszerelés', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('packageContents', 'A csomag tartalma', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('dosing', 'Adagolási rend', 'DOSE', 'DOSE', NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, false, false, NULL, CURRENT_TIMESTAMP),
('manufacturerClaims', 'A gyártó állításai', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'PROSE', NULL, true, true, false, NULL, CURRENT_TIMESTAMP),
('manufacturerInfo', 'Gyártó (GPSR)', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, true, true, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
