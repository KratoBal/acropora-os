-- #1582 P2: the publish request time. It is set on the first publish request
-- and becomes the PDF's CreationDate, so a second click renders the same bytes
-- (barracuda's independent remeasurement, P2 item). Nullable: drafts that were
-- never published have none.
ALTER TABLE "QuoteVersion" ADD COLUMN "publishRequestedAt" TIMESTAMP(3);
