-- === PARTNER ORDERS, SLICE 1 (2026-11-04) ===
--
-- Értékesítés > Megrendelések: an order starts from an ACCEPTED quote and links to its accepted
-- version (no copied items). Only the order header and the attached documents live here; the
-- completion certificate and invoicing slices add their own columns later. Additive only.

-- CreateEnum
CREATE TYPE "PartnerOrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartnerOrderDocumentStep" AS ENUM ('INQUIRY', 'QUOTE', 'SIGNED_ORDER_FORM', 'COMPLETION', 'SIGNED_COMPLETION', 'INVOICE', 'OTHER');

-- CreateTable
CREATE TABLE "PartnerOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "PartnerOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerOrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "step" "PartnerOrderDocumentStep" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerOrder_orderNumber_key" ON "PartnerOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerOrder_quoteId_key" ON "PartnerOrder"("quoteId");

-- CreateIndex
CREATE INDEX "PartnerOrder_status_createdAt_idx" ON "PartnerOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerOrder_customerId_idx" ON "PartnerOrder"("customerId");

-- CreateIndex
CREATE INDEX "PartnerOrderDocument_orderId_step_idx" ON "PartnerOrderDocument"("orderId", "step");

-- AddForeignKey
ALTER TABLE "PartnerOrder" ADD CONSTRAINT "PartnerOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrder" ADD CONSTRAINT "PartnerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrder" ADD CONSTRAINT "PartnerOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrderDocument" ADD CONSTRAINT "PartnerOrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PartnerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrderDocument" ADD CONSTRAINT "PartnerOrderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

