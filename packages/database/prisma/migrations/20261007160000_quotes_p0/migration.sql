-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuoteBlockKind" AS ENUM ('TEXT', 'SECTION', 'OPTIONS', 'SUMMARY', 'TERMS', 'IMAGE', 'PAGE_BREAK');

-- CreateEnum
CREATE TYPE "QuoteItemSource" AS ENUM ('STANDALONE', 'PRODUCT', 'BOM');

-- CreateEnum
CREATE TYPE "QuoteBomItemKind" AS ENUM ('PRODUCT', 'CUSTOM', 'SERVICE');

-- CreateEnum
CREATE TYPE "QuoteCostSource" AS ENUM ('LAST_PURCHASE', 'SUPPLIER_QUOTE', 'MANUAL', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "QuoteCloseReason" AS ENUM ('PRICE', 'COMPETITOR', 'PROJECT_CANCELLED', 'PROJECT_POSTPONED', 'NO_RESPONSE', 'SCOPE_CHANGED', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteEventKind" AS ENUM ('CREATED', 'VERSION_CREATED', 'PUBLISHED', 'SENT', 'SEND_FAILED', 'LINK_ISSUED', 'LINK_REVOKED', 'LINK_OPENED', 'ACCEPTED', 'ACCEPTANCE_REVOKED', 'REJECTED', 'POSTPONED', 'CANCELLED', 'HANDOFF_EXECUTED');

-- CreateEnum
CREATE TYPE "QuoteSnippetKind" AS ENUM ('INTRO', 'TEXT', 'DELIVERY', 'WARRANTY', 'PAYMENT');

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT,
    "closeReason" "QuoteCloseReason",
    "closeNote" TEXT,
    "postponedUntil" DATE,
    "acceptedVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "priceDisplay" TEXT NOT NULL,
    "customerSnapshot" JSONB,
    "templateId" TEXT,
    "pdfStorageKey" TEXT,
    "pdfSha256" VARCHAR(64),
    "pageCount" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdFromVersionId" TEXT,

    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteBlock" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuoteBlockKind" NOT NULL,
    "title" TEXT,
    "content" JSONB,
    "keepWithNext" BOOLEAN NOT NULL DEFAULT false,
    "startOnNewPage" BOOLEAN NOT NULL DEFAULT false,
    "sourceSnippetId" TEXT,

    CONSTRAINT "QuoteBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "QuoteItemSource" NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "description" JSONB,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitNetPrice" DECIMAL(19,4) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "isOptional" BOOLEAN NOT NULL,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteBomItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "quoteItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuoteBomItemKind" NOT NULL,
    "variantId" TEXT,
    "customName" TEXT,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(19,4),
    "costCurrency" VARCHAR(3),
    "costOriginal" DECIMAL(19,4),
    "exchangeRate" DECIMAL(19,6),
    "costSource" "QuoteCostSource",
    "costSourceDate" TIMESTAMP(3),
    "sourcePurchaseInvoiceLineId" TEXT,
    "supplierId" TEXT,
    "supplierSku" TEXT,
    "internalNote" TEXT,
    "createdProductVariantId" TEXT,

    CONSTRAINT "QuoteBomItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotePaymentMilestone" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "QuotePaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "milestones" JSONB NOT NULL,
    "priceDisplay" TEXT NOT NULL,
    "defaultValidityDays" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnippet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "QuoteSnippetKind" NOT NULL,
    "content" JSONB NOT NULL,
    "milestones" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteEvent" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "versionId" TEXT,
    "kind" "QuoteEventKind" NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_acceptedVersionId_key" ON "Quote"("acceptedVersionId");

-- CreateIndex
CREATE INDEX "Quote_status_updatedAt_idx" ON "Quote"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_versionNumber_key" ON "QuoteVersion"("quoteId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteBlock_versionId_position_key" ON "QuoteBlock"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteBlock_id_versionId_key" ON "QuoteBlock"("id", "versionId");

-- CreateIndex
CREATE INDEX "QuoteItem_versionId_idx" ON "QuoteItem"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteItem_blockId_position_key" ON "QuoteItem"("blockId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteItem_id_versionId_key" ON "QuoteItem"("id", "versionId");

-- CreateIndex
CREATE INDEX "QuoteBomItem_versionId_idx" ON "QuoteBomItem"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteBomItem_quoteItemId_position_key" ON "QuoteBomItem"("quoteItemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuotePaymentMilestone_versionId_position_key" ON "QuotePaymentMilestone"("versionId", "position");

-- CreateIndex
CREATE INDEX "QuoteSnippet_kind_archivedAt_idx" ON "QuoteSnippet"("kind", "archivedAt");

-- CreateIndex
CREATE INDEX "QuoteEvent_quoteId_createdAt_idx" ON "QuoteEvent"("quoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_acceptedVersionId_fkey" FOREIGN KEY ("acceptedVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuoteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_createdFromVersionId_fkey" FOREIGN KEY ("createdFromVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBlock" ADD CONSTRAINT "QuoteBlock_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBlock" ADD CONSTRAINT "QuoteBlock_sourceSnippetId_fkey" FOREIGN KEY ("sourceSnippetId") REFERENCES "QuoteSnippet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_blockId_versionId_fkey" FOREIGN KEY ("blockId", "versionId") REFERENCES "QuoteBlock"("id", "versionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_quoteItemId_versionId_fkey" FOREIGN KEY ("quoteItemId", "versionId") REFERENCES "QuoteItem"("id", "versionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_createdProductVariantId_fkey" FOREIGN KEY ("createdProductVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_sourcePurchaseInvoiceLineId_fkey" FOREIGN KEY ("sourcePurchaseInvoiceLineId") REFERENCES "PurchaseInvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePaymentMilestone" ADD CONSTRAINT "QuotePaymentMilestone_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnippet" ADD CONSTRAINT "QuoteSnippet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnippet" ADD CONSTRAINT "QuoteSnippet_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteEvent" ADD CONSTRAINT "QuoteEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteEvent" ADD CONSTRAINT "QuoteEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteEvent" ADD CONSTRAINT "QuoteEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A global monotonic sequence, like ProjectNumberSequence; the Hungarian year is a label.
CREATE SEQUENCE "QuoteNumberSequence" START WITH 1 INCREMENT BY 1;

ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_publication_complete_check"
 CHECK ("status" = 'DRAFT' OR (
  "pdfStorageKey" IS NOT NULL AND "pdfSha256" IS NOT NULL AND
  "pageCount" IS NOT NULL AND "publishedAt" IS NOT NULL
 ));
CREATE UNIQUE INDEX "QuoteVersion_one_draft_per_quote_idx"
 ON "QuoteVersion" ("quoteId") WHERE "status" = 'DRAFT';
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_product_variant_check"
 CHECK ("source" <> 'PRODUCT' OR "variantId" IS NOT NULL);
ALTER TABLE "QuoteBomItem" ADD CONSTRAINT "QuoteBomItem_identity_check"
 CHECK (("kind" = 'PRODUCT' AND "variantId" IS NOT NULL) OR
        ("kind" <> 'PRODUCT' AND "customName" IS NOT NULL));
-- JSON null does not represent configured payment milestones.
ALTER TABLE "QuoteSnippet" ADD CONSTRAINT "QuoteSnippet_payment_milestones_check"
 CHECK (("kind" = 'PAYMENT' AND "milestones" IS NOT NULL AND jsonb_typeof("milestones") = 'array') OR ("kind" <> 'PAYMENT' AND "milestones" IS NULL));
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_price_display_check"
 CHECK ("priceDisplay" IN ('NET','GROSS','BOTH'));
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_price_display_check"
 CHECK ("priceDisplay" IN ('NET','GROSS','BOTH'));
