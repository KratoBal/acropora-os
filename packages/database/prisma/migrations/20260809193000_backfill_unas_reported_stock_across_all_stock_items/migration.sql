-- The preceding snapshot backfill intentionally considered only the
-- warehouse-wide StockItem row (locationId/lotId both NULL). The stock
-- reconciliation page, however, compares UNAS against the variant's free
-- stock summed across every StockItem row. A variant whose stock is stored
-- exclusively on located or lot-tracked rows was therefore skipped even
-- when the last successful publish target still exactly matched its current
-- local free stock.
--
-- Repeat the same guarded backfill using the reconciliation page's stock
-- universe. This updates only a stale snapshot whose latest real successful
-- publish is still the latest outbox event and whose recorded absolute target
-- exactly equals the current free stock across all warehouses/locations/lots.
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
