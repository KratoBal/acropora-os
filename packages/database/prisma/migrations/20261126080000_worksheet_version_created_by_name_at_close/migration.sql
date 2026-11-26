-- Worksheet PDF "Felvette" line (card f450672c): freeze the creator's name when the version is closed, so a regenerated sheet no longer follows a renamed or deleted account.
-- Additive: one nullable column. Rows closed before this migration are filled with the account's CURRENT name (the best value available; an older name was never stored).

-- AlterTable
ALTER TABLE "WorksheetVersion" ADD COLUMN     "createdByNameAtClose" TEXT;

UPDATE "WorksheetVersion" AS v
SET "createdByNameAtClose" = u."displayName"
FROM "User" AS u
WHERE v."createdById" = u."id" AND v."closedAt" IS NOT NULL;
