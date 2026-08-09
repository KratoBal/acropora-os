-- Successful setStock calls historically closed the outbox row without
-- refreshing ProductVariant.unasReportedStock. Backfill only rows for which
-- the latest real publish is also the latest outbox event and its recorded
-- absolute target still equals the current available local stock. These
-- guards deliberately skip any ambiguous or subsequently changed variant.
WITH "latestRealPublish" AS (
  SELECT DISTINCT ON (o."variantId")
    o."variantId",
    o."sequence",
    o."targetOnHand",
    o."processedAt"
  FROM "UnasStockSyncOutbox" o
  WHERE o."status" = 'SUCCEEDED'
    AND o."resolutionNote" IS NULL
    AND o."processedAt" IS NOT NULL
  ORDER BY o."variantId", o."sequence" DESC
),
"currentAvailableStock" AS (
  SELECT
    s."variantId",
    SUM(s."onHand" - s."reserved")::DECIMAL(19, 6) AS "quantity"
  FROM "StockItem" s
  WHERE s."locationId" IS NULL
    AND s."lotId" IS NULL
  GROUP BY s."variantId"
)
UPDATE "ProductVariant" pv
SET
  "unasReportedStock" = publish."targetOnHand",
  "unasReportedStockSyncedAt" = publish."processedAt",
  "updatedAt" = now()
FROM "latestRealPublish" publish
JOIN "currentAvailableStock" stock
  ON stock."variantId" = publish."variantId"
 AND stock."quantity" = publish."targetOnHand"
WHERE pv."id" = publish."variantId"
  AND (
    pv."unasReportedStockSyncedAt" IS NULL
    OR pv."unasReportedStockSyncedAt" < publish."processedAt"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "UnasStockSyncOutbox" newer
    WHERE newer."variantId" = publish."variantId"
      AND newer."sequence" > publish."sequence"
  );
