-- CreateEnum
CREATE TYPE "WebshopShortageStatus" AS ENUM ('OPEN', 'AGREED', 'DONE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WebshopShortageChoice" AS ENUM ('SPLIT', 'REPLACE', 'REMOVE');

-- CreateEnum
CREATE TYPE "WebshopShortageChannel" AS ENUM ('PHONE', 'EMAIL', 'OTHER');

-- CreateTable
CREATE TABLE "WebshopOrderShortage" (
    "id" TEXT NOT NULL,
    "orderId" VARCHAR(64) NOT NULL,
    "status" "WebshopShortageStatus" NOT NULL DEFAULT 'OPEN',
    "choice" "WebshopShortageChoice",
    "channel" "WebshopShortageChannel",
    "agreedAt" TIMESTAMP(3),
    "agreementNote" TEXT,
    "splitOrderId" VARCHAR(64),
    "resolutionNote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebshopOrderShortage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebshopOrderShortageLine" (
    "id" TEXT NOT NULL,
    "shortageId" TEXT NOT NULL,
    "itemId" VARCHAR(64) NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "availableQuantity" INTEGER,
    "agreedQuantity" INTEGER,
    "replacementVariantId" VARCHAR(64),
    "replacementSku" TEXT,

    CONSTRAINT "WebshopOrderShortageLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebshopOrderShortage_orderId_detectedAt_idx" ON "WebshopOrderShortage"("orderId", "detectedAt");

-- CreateIndex
CREATE INDEX "WebshopOrderShortage_status_detectedAt_idx" ON "WebshopOrderShortage"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "WebshopOrderShortageLine_itemId_idx" ON "WebshopOrderShortageLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "WebshopOrderShortageLine_shortageId_itemId_key" ON "WebshopOrderShortageLine"("shortageId", "itemId");

-- AddForeignKey
ALTER TABLE "WebshopOrderShortageLine" ADD CONSTRAINT "WebshopOrderShortageLine_shortageId_fkey" FOREIGN KEY ("shortageId") REFERENCES "WebshopOrderShortage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

