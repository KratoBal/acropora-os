-- A TICKET@ VAZLAT AI OSSZEFOGLALOJA (kartya ec7b947b, S3b): nullable oszlopok, meglevo sort nem erint (a Capasuli vazlatoknal es az AI nelkuli
-- ticket vazlatoknal NULL marad).

-- AlterTable
ALTER TABLE "ServiceTicketDraft" ADD COLUMN "aiSummary" VARCHAR(1000),
ADD COLUMN "aiExtractedBy" VARCHAR(128);
