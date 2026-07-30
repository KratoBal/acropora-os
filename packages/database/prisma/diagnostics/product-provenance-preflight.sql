-- Product provenance preflight
--
-- Run read-only before the later contract migration makes Product.origin and
-- Product.catalogAuthority NOT NULL. An empty result means that mirrorSource,
-- the UNAS snapshot and the UNAS external reference agree.
WITH provenance_signals AS (
  SELECT
    p."id",
    p."name",
    p."mirrorSource",
    EXISTS (
      SELECT 1
      FROM "UnasProductSnapshot" ups
      WHERE ups."productId" = p."id"
    ) AS "hasUnasSnapshot",
    EXISTS (
      SELECT 1
      FROM "ExternalReference" er
      WHERE er."system" = 'UNAS'
        AND er."entityType" = 'Product'
        AND er."entityId" = p."id"
    ) AS "hasUnasExternalReference"
  FROM "Product" p
)
SELECT
  "id",
  "name",
  "mirrorSource",
  "hasUnasSnapshot",
  "hasUnasExternalReference",
  CASE
    WHEN "mirrorSource" = 'UNAS'
      AND NOT "hasUnasSnapshot"
      AND NOT "hasUnasExternalReference"
      THEN 'UNAS_MIRROR_WITHOUT_SOURCE_EVIDENCE'
    WHEN "mirrorSource" IS DISTINCT FROM 'UNAS'
      AND "hasUnasSnapshot"
      THEN 'LOCAL_CLASSIFICATION_WITH_UNAS_SNAPSHOT'
    WHEN "mirrorSource" IS DISTINCT FROM 'UNAS'
      AND "hasUnasExternalReference"
      THEN 'LOCAL_CLASSIFICATION_WITH_UNAS_REFERENCE'
    WHEN "hasUnasSnapshot" <> "hasUnasExternalReference"
      THEN 'INCOMPLETE_UNAS_SOURCE_EVIDENCE'
  END AS "conflictCode"
FROM provenance_signals
WHERE
  (
    "mirrorSource" = 'UNAS'
    AND NOT "hasUnasSnapshot"
    AND NOT "hasUnasExternalReference"
  )
  OR (
    "mirrorSource" IS DISTINCT FROM 'UNAS'
    AND ("hasUnasSnapshot" OR "hasUnasExternalReference")
  )
  OR "hasUnasSnapshot" <> "hasUnasExternalReference"
ORDER BY "conflictCode", "id";
