-- A TÁROLT SZÁMLÁZZ.HU FEED VISSZATÖLTÉSE (6fd8c574; acrobot 43766): a feedből hiányzó számok, és amit a Számlázz.hu
-- Agent rájuk felelt. Új, üres tábla, meglévő sort nem érint. ROLLBACK: DROP TABLE "SzamlazzFeedBackfillNumber"; (a
-- következő száraz kör minden hiányzó számot újra megkérdez; a behúzott számlák a feed-üzenetek között maradnak).

-- CreateTable
CREATE TABLE "SzamlazzFeedBackfillNumber" (
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "checkedById" TEXT NOT NULL,
    "storedAt" TIMESTAMP(3),

    CONSTRAINT "SzamlazzFeedBackfillNumber_pkey" PRIMARY KEY ("number")
);

-- CreateIndex
CREATE INDEX "SzamlazzFeedBackfillNumber_series_outcome_idx" ON "SzamlazzFeedBackfillNumber"("series", "outcome");

