-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "passwordHash" TEXT,
    ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);

-- Backfill: best-effort split of the existing displayName into first/last
-- name so pre-existing (dev/seed) rows are not left blank. New rows created
-- through the Users admin API always populate both fields explicitly.
UPDATE "User"
SET
    "firstName" = split_part("displayName", ' ', 1),
    "lastName" = CASE
        WHEN position(' ' in "displayName") > 0
            THEN substring("displayName" from position(' ' in "displayName") + 1)
        ELSE ''
    END
WHERE "firstName" = '' AND "lastName" = '';
