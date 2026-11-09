-- ReefClub V3.2 (card cd94ed11, task reefclub-kifogyas-emlekezteto), slice 3a: the unsubscribe key is no longer stored. It is computed
-- (HMAC of the row id under a server secret), so every mail ever sent keeps a working link and the table holds nothing a copy could
-- unsubscribe with (barracuda, #2305; acrobot, 44788). The table is EMPTY (the switch REEFCLUB_RUNOUT_ENABLED is off and the consent
-- text is not given, so nothing has written to it), which is why the column is dropped: there is no key to carry over.
-- ROLLBACK: add back "unsubscribeToken" TEXT NOT NULL with its unique index (only valid while the table is empty).

-- DropIndex
DROP INDEX "ReefClubRunOutReminder_unsubscribeToken_key";

-- AlterTable
ALTER TABLE "ReefClubRunOutReminder" DROP COLUMN "unsubscribeToken";
