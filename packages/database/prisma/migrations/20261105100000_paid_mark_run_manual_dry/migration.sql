-- A kifizetett-jeloles kezi inditasa es a dry futasok eredmenye (kartya e64540fd).
-- Csak uj oszlopok alapertekkel: a meglevo sorok a napi auto futasok.
ALTER TABLE "PaidMarkRun" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "PaidMarkRun" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'schedule';
ALTER TABLE "PaidMarkRun" ADD COLUMN "triggeredById" TEXT;
ALTER TABLE "PaidMarkRun" ADD COLUMN "planned" JSONB NOT NULL DEFAULT '[]';
