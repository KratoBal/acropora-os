-- ReefClub V3.2 (card cd94ed11, task reefclub-kifogyas-emlekezteto), slice 5: the sender's state on the run-out reminder row.
-- Additive only: six nullable or defaulted columns; the OS process writes them, the ReefClub role gets no right on them.
-- ROLLBACK: drop the six columns remindedForRunOut, remindedAt, remindStartSource, remindClaimedAt, remindAttempts, remindAttemptsFor.

-- AlterTable
ALTER TABLE "ReefClubRunOutReminder" ADD COLUMN     "remindAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remindAttemptsFor" DATE,
ADD COLUMN     "remindClaimedAt" TIMESTAMP(3),
ADD COLUMN     "remindStartSource" VARCHAR(16),
ADD COLUMN     "remindedAt" TIMESTAMP(3),
ADD COLUMN     "remindedForRunOut" DATE;

