-- The daily price leaves a trace. Append-only: no unique key on productId, and
-- nothing in the code updates a row once written.
--
-- Two timestamps on purpose. observedAt says WHEN THE PRICE WAS TRUE (the sync
-- window's end); createdAt says when we wrote it down. For a thirty-day legal
-- window the deadline follows the first, and a single column would quietly
-- report the second.

CREATE TYPE "PriceHistorySource" AS ENUM ('INITIAL', 'UNAS_SYNC');

CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currency" VARCHAR(3),
    "netPrice" DECIMAL(19,4),
    "grossPrice" DECIMAL(19,4),
    "saleNetPrice" DECIMAL(19,4),
    "saleGrossPrice" DECIMAL(19,4),
    "source" "PriceHistorySource" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- The Omnibus question ("what was the lowest price in the last thirty days")
-- runs on exactly this index: one product, in time order.
CREATE INDEX "ProductPriceHistory_productId_observedAt_idx"
    ON "ProductPriceHistory"("productId", "observedAt");

ALTER TABLE "ProductPriceHistory"
    ADD CONSTRAINT "ProductPriceHistory_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
