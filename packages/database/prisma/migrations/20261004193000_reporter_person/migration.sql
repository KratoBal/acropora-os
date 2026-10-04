-- Additive: existing tickets and drafts retain NULL.
ALTER TABLE "ServiceJob" ADD COLUMN "reporterPersonName" VARCHAR(200);
ALTER TABLE "ServiceTicketDraft" ADD COLUMN "reporterPersonName" VARCHAR(200);
