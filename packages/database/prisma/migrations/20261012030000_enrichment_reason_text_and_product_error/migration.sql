-- The fetch reason carries the water-effects lexicon notes since #1669: free text,
-- which overflowed VARCHAR(64) and stopped the third batch of the water-effects run
-- (P2000). Postgres changes VARCHAR to TEXT without rewriting the table.
ALTER TABLE "ProductEnrichmentSourceFetch" ALTER COLUMN "reason" SET DATA TYPE TEXT;

-- A product the run could not store is recorded with its error, and the run goes on.
ALTER TABLE "ProductEnrichmentRunProduct" ADD COLUMN "errorCode" TEXT;
