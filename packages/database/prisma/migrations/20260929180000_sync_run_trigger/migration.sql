-- Who started a Gmail pull run: the timer or a person. New, nullable column
-- only: the existing runs stay NULL (unknown); no value is made up for them.
CREATE TYPE "SyncRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

ALTER TABLE "GlsSyncRun" ADD COLUMN "trigger" "SyncRunTrigger";

ALTER TABLE "FoxpostSyncRun" ADD COLUMN "trigger" "SyncRunTrigger";
