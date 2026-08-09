-- One historical Aquavital 250 g snapshot remained stale after the general
-- backfills. Its successful zero-stock publication predates a later -1
-- snapshot, so the intentionally conservative timestamp guard correctly
-- refused to overwrite it. Operations verified that live UNAS stock and
-- current local available stock are both zero.
--
-- Correct only that fully identified historical state. If any identifier,
-- snapshot value/timestamp, outbox fact, or current-stock fact has changed,
-- this statement updates no rows. It does not touch StockItem and does not
-- publish anything to UNAS.
WITH "eligibleSnapshot" AS (
  SELECT
    pv."id" AS "variantId",
    pv."productId",
    o."targetOnHand",
    now() AS "verifiedAt"
  FROM "ProductVariant" pv
  JOIN "Product" p
    ON p."id" = pv."productId"
  JOIN "UnasProductSnapshot" ups
    ON ups."productId" = pv."productId"
  JOIN "UnasStockSyncOutbox" o
    ON o."variantId" = pv."id"
   AND o."sequence" = 195
  WHERE pv."id" = 'cms0qh0of036pli065gu40s18'
    AND pv."sku" = '4005258004912'
    AND p."name" = 'Aquavital Perlonvatta 250g'
    AND pv."unasReportedStock" = (-1)::DECIMAL(19, 6)
    AND pv."unasReportedStockSyncedAt" = TIMESTAMP '2026-08-03 21:27:13.705'
    AND ups."reportedStock" = (-1)::DECIMAL(19, 6)
    AND ups."reportedStockSyncedAt" = TIMESTAMP '2026-08-03 21:27:13.705'
    AND o."status" = 'SUCCEEDED'
    AND o."resolutionNote" IS NULL
    AND o."targetOnHand" = 0::DECIMAL(19, 6)
    AND o."processedAt" = TIMESTAMP '2026-07-31 07:48:38.443'
    AND NOT EXISTS (
      SELECT 1
      FROM "UnasStockSyncOutbox" newer
      WHERE newer."variantId" = pv."id"
        AND newer."sequence" > o."sequence"
    )
    AND (
      SELECT COALESCE(
        SUM(s."onHand" - s."reserved"),
        0::DECIMAL(19, 6)
      )::DECIMAL(19, 6)
      FROM "StockItem" s
      WHERE s."variantId" = pv."id"
    ) = o."targetOnHand"
),
"updatedVariant" AS (
  UPDATE "ProductVariant" pv
  SET
    "unasReportedStock" = eligible."targetOnHand",
    "unasReportedStockSyncedAt" = eligible."verifiedAt",
    "updatedAt" = now()
  FROM "eligibleSnapshot" eligible
  WHERE pv."id" = eligible."variantId"
    AND pv."unasReportedStock" = (-1)::DECIMAL(19, 6)
    AND pv."unasReportedStockSyncedAt" = TIMESTAMP '2026-08-03 21:27:13.705'
  RETURNING
    eligible."productId",
    eligible."targetOnHand",
    eligible."verifiedAt"
)
UPDATE "UnasProductSnapshot" ups
SET
  "reportedStock" = updated."targetOnHand",
  "reportedStockSyncedAt" = updated."verifiedAt",
  "updatedAt" = now()
FROM "updatedVariant" updated
WHERE ups."productId" = updated."productId"
  AND ups."reportedStock" = (-1)::DECIMAL(19, 6)
  AND ups."reportedStockSyncedAt" = TIMESTAMP '2026-08-03 21:27:13.705';
