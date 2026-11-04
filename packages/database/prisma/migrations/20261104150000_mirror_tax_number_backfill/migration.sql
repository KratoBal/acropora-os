-- The partner's tax number onto its customer mirror, once, for the mirrors created before the sync carried it (card aaf4f09d; Balázs, 2026-11-04 11:43 UTC: every invoice to the zoo went out without a tax number). From now on syncWorksheetMirror carries it on every partner save; this fills the rows saved before.
-- Idempotent and narrow: only a mirror (Supplier.customerId) whose target field is empty, only from a non-empty partner tax number; a Hungarian partner (country HU) fills taxNumber, a foreign one euTaxNumber, the same rule as mirroredTaxNumber(). No other column, no other row; a value already on the mirror is never overwritten. Issued invoices are not touched (their buyer snapshot stays as sent).
-- ROLLBACK: none needed for correctness (a filled tax number is the intended state); to undo exactly, the filled rows are the mirrors whose value equals the partner's and was empty before this migration, which this migration does not record.
UPDATE "Customer" AS c
SET "taxNumber" = btrim(s."taxNumber")
FROM "Supplier" AS s
WHERE s."customerId" = c."id"
  AND s."taxNumber" IS NOT NULL
  AND btrim(s."taxNumber") <> ''
  AND upper(btrim(coalesce(s."country", 'HU'))) = 'HU'
  AND (c."taxNumber" IS NULL OR btrim(c."taxNumber") = '');

UPDATE "Customer" AS c
SET "euTaxNumber" = btrim(s."taxNumber")
FROM "Supplier" AS s
WHERE s."customerId" = c."id"
  AND s."taxNumber" IS NOT NULL
  AND btrim(s."taxNumber") <> ''
  AND upper(btrim(coalesce(s."country", 'HU'))) <> 'HU'
  AND (c."euTaxNumber" IS NULL OR btrim(c."euTaxNumber") = '');
