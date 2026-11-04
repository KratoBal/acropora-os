-- Own sale price per variant (T4.1-D3). Additive: three nullable columns and two CHECKs; no existing row changes (every row has the three as NULL, which both CHECKs accept).
-- ROLLBACK: ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_own_sale_window", DROP CONSTRAINT "ProductVariant_own_sale_triple", DROP COLUMN "sellingSaleEndsAt", DROP COLUMN "sellingSaleStartsAt", DROP COLUMN "sellingSaleGrossPrice";
ALTER TABLE "ProductVariant" ADD COLUMN     "sellingSaleGrossPrice" DECIMAL(19,4),
ADD COLUMN     "sellingSaleStartsAt" TIMESTAMP(3),
ADD COLUMN     "sellingSaleEndsAt" TIMESTAMP(3);

-- the three together or none: a price without a window, or a window without a price, would be a silent half-state
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_own_sale_triple"
  CHECK (
    ("sellingSaleGrossPrice" IS NULL AND "sellingSaleStartsAt" IS NULL AND "sellingSaleEndsAt" IS NULL)
    OR
    ("sellingSaleGrossPrice" IS NOT NULL AND "sellingSaleStartsAt" IS NOT NULL AND "sellingSaleEndsAt" IS NOT NULL)
  );

-- a sale is a positive price in a non-empty window
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_own_sale_window"
  CHECK (
    "sellingSaleGrossPrice" IS NULL
    OR ("sellingSaleGrossPrice" > 0 AND "sellingSaleStartsAt" < "sellingSaleEndsAt")
  );
