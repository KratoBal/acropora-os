-- The reason of a collection verdict (card os-hianyzo-szamlak-unpaid): which condition failed for an UNMATCHED letter.
-- Add only: a nullable column, no backfill, no default. Rows written before this keep NULL until the next re-read of the letter.
ALTER TABLE "InvoiceCollectionItem" ADD COLUMN "reason" VARCHAR(40);
