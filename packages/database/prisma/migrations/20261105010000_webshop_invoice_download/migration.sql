-- A VENDÉG SZÁMLA-LETÖLTÉSÉNEK EGYSZER HASZNÁLATOS TOKENJE ÉS NAPLÓJA (V1.1, acrobot 2026-11-05). Egy új, üres
-- tábla; meglévő sort nem érint. A teljes indoklás a sémában áll.

-- CreateTable
CREATE TABLE "WebshopInvoiceDownload" (
    "jti" VARCHAR(64) NOT NULL,
    "orderId" VARCHAR(64) NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebshopInvoiceDownload_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "WebshopInvoiceDownload_orderId_redeemedAt_idx" ON "WebshopInvoiceDownload"("orderId", "redeemedAt");
