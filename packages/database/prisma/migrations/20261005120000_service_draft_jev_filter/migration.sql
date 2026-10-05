-- Cápasuli daily report items: the Jev filter state per draft (Balázs, 2026-10-05; acrobot memory 2069).
-- Existing drafts become UNFILTERED (they stay visible, as today); nothing is deleted.
-- CreateEnum
CREATE TYPE "ServiceDraftFilterState" AS ENUM ('UNFILTERED', 'PASSED', 'UNCERTAIN', 'FILTERED', 'PROMOTED');

-- AlterTable
ALTER TABLE "ServiceTicketDraft" ADD COLUMN     "decisionRunId" TEXT,
ADD COLUMN     "filterState" "ServiceDraftFilterState" NOT NULL DEFAULT 'UNFILTERED',
ADD COLUMN     "jevClass" VARCHAR(40),
ADD COLUMN     "jevConfidence" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "ServiceTicketDraft_status_filterState_idx" ON "ServiceTicketDraft"("status", "filterState");

