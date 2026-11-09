-- ReefClub V3.2 (card cd94ed11, task reefclub-kifogyas-emlekezteto), slice 3a: the unsubscribe key is kept as a HASH (barracuda, #2305),
-- so a copy of the table cannot unsubscribe anyone. The table is EMPTY (the switch REEFCLUB_RUNOUT_ENABLED is off and the consent text
-- is not given, so nothing has written to it), which is why the plain column is dropped rather than converted: there is no key to
-- carry over. The new column is nullable (no key until a mail is composed); a unique index on a nullable column allows many NULLs.
-- ROLLBACK: drop "unsubscribeKeyHash" and add back "unsubscribeToken" TEXT NOT NULL with its unique index (only valid while the table is empty).

-- DropIndex
DROP INDEX "ReefClubRunOutReminder_unsubscribeToken_key";

-- AlterTable
ALTER TABLE "ReefClubRunOutReminder" DROP COLUMN "unsubscribeToken",
ADD COLUMN     "unsubscribeKeyHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubRunOutReminder_unsubscribeKeyHash_key" ON "ReefClubRunOutReminder"("unsubscribeKeyHash");
