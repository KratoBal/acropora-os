-- Persist the UNAS package-product contract separately from rawPayload so
-- inventory code can enforce it without parsing provider JSON at runtime.
ALTER TABLE "UnasProductSnapshot"
  ADD COLUMN "isPackageProduct" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "packageComponents" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Existing full getProduct snapshots already contain these nodes in
-- rawPayload. Backfill both the explicit flag and a normalized component
-- array so deployment does not require waiting for every product's
-- LastModTime to change before package safety becomes active.
UPDATE "UnasProductSnapshot"
SET
  "packageComponents" = coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'sku', component ->> 'Sku',
          'qty', component ->> 'Qty'
        )
      )
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof("rawPayload" #> '{PackageComponents,Component}') = 'array'
            THEN "rawPayload" #> '{PackageComponents,Component}'
          WHEN jsonb_typeof("rawPayload" #> '{PackageComponents,Component}') = 'object'
            THEN jsonb_build_array("rawPayload" #> '{PackageComponents,Component}')
          ELSE '[]'::jsonb
        END
      ) AS component
      WHERE nullif(component ->> 'Sku', '') IS NOT NULL
        AND nullif(component ->> 'Qty', '') IS NOT NULL
    ),
    '[]'::jsonb
  ),
  "isPackageProduct" = CASE
    WHEN lower(coalesce("rawPayload" ->> 'PackageProduct', '')) IN ('1', 'yes', 'true', 'on')
      THEN true
    WHEN jsonb_typeof("rawPayload" #> '{PackageComponents,Component}') IN ('array', 'object')
      THEN true
    ELSE false
  END;

CREATE INDEX "UnasProductSnapshot_isPackageProduct_idx"
  ON "UnasProductSnapshot"("isPackageProduct");

-- Package stock is computed by UNAS from its components. Preserve every
-- historical outbox row, but close all still-open/failed package publishes
-- without another setStock call. resolutionNote makes the one-time cleanup
-- distinguishable from a real successful publish.
UPDATE "UnasStockSyncOutbox" AS outbox
SET
  "status" = 'SUCCEEDED',
  "lastError" = NULL,
  "resolutionNote" = 'package_product_not_stock_managed:migration_20260731110000',
  "leaseExpiresAt" = NULL,
  "processedAt" = now(),
  "updatedAt" = now()
FROM "ProductVariant" AS variant
JOIN "UnasProductSnapshot" AS snapshot
  ON snapshot."productId" = variant."productId"
WHERE outbox."variantId" = variant."id"
  AND snapshot."isPackageProduct" = true
  AND outbox."status" IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER');
