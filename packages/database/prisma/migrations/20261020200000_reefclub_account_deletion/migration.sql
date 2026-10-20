-- ReefClub, slice 6 (task reefclub-szelet-6, plan v6.1 section 4.5): the account deletion request and
-- its log. Additive only: one nullable column on ReefClubAccount and one new table without foreign
-- keys (the log outlives the account row it names).
-- ROLLBACK: drop the table ReefClubAccountDeletion and the column "deletionRequestedAt". An account
-- locked for deletion at that moment becomes usable again, so a rollback during a pending deletion
-- first finishes or cancels those deletions by hand.
-- AlterTable
ALTER TABLE "ReefClubAccount" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReefClubAccountDeletion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReefClubAccountDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReefClubAccountDeletion_completedAt_requestedAt_idx" ON "ReefClubAccountDeletion"("completedAt", "requestedAt");

-- CreateIndex
CREATE INDEX "ReefClubAccountDeletion_accountId_idx" ON "ReefClubAccountDeletion"("accountId");

