-- #1582 P4a: a customer's acceptance, recorded by hand, and the quote's
-- closing states (rejected with a reason, postponed to a date, cancelled).
-- The quote's own columns (closeReason, closeNote, postponedUntil,
-- acceptedVersionId) already exist since P0; here they get their rules.
-- CreateEnum
CREATE TYPE "QuoteAcceptanceSource" AS ENUM ('PHONE', 'EMAIL', 'IN_PERSON', 'OTHER_MANUAL');

-- CreateTable
CREATE TABLE "QuoteAcceptance" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "source" "QuoteAcceptanceSource" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedByName" TEXT,
    "acceptedByEmail" TEXT,
    "recordedByUserId" TEXT,
    "selectedOptionalItemIds" TEXT[],
    "note" TEXT,
    "requestId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteAcceptance_requestId_key" ON "QuoteAcceptance"("requestId");

-- CreateIndex
CREATE INDEX "QuoteAcceptance_quoteId_createdAt_idx" ON "QuoteAcceptance"("quoteId", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteAcceptance_quoteVersionId_idx" ON "QuoteAcceptance"("quoteVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_id_quoteId_key" ON "QuoteVersion"("id", "quoteId");

-- AddForeignKey
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "QuoteVersion"("id", "quoteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one LIVE acceptance per quote: a double click, or two people at
-- once, cannot record two. A revoked one stays as history.
CREATE UNIQUE INDEX "QuoteAcceptance_one_live_per_quote_idx"
 ON "QuoteAcceptance" ("quoteId") WHERE "revokedAt" IS NULL;
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_revoke_reason_check"
 CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));

-- The quote's status and its columns agree (every existing quote is a DRAFT
-- with all four empty, so these hold for the existing rows).
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_postponed_until_check"
 CHECK (("status" = 'POSTPONED') = ("postponedUntil" IS NOT NULL));
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rejected_reason_check"
 CHECK ("status" <> 'REJECTED' OR "closeReason" IS NOT NULL);
