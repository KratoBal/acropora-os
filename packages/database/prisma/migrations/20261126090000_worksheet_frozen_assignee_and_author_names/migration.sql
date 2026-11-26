-- Worksheet PDF (card f450672c, part 2): the "Dolgozott rajta" names and the journal authors were read live at render time, so a regenerated sheet followed a rename or a removed account. Freeze them: the assignee names at close, the author name at write.
-- Additive only: two new columns and their backfill. Rows that exist before this migration are filled with the CURRENT names (the best value available; older names were never stored).

-- AlterTable
ALTER TABLE "WorksheetVersion" ADD COLUMN     "assigneeNamesAtClose" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WorksheetEntry" ADD COLUMN     "authorName" TEXT;

-- Closed versions: the worksheet's current assignees, in the same order the live list uses (assignedAt, then userId).
UPDATE "WorksheetVersion" AS v
SET "assigneeNamesAtClose" = COALESCE(
  (
    SELECT array_agg(u."displayName" ORDER BY a."assignedAt", a."userId")
    FROM "WorksheetAssignee" AS a
    JOIN "User" AS u ON u."id" = a."userId"
    WHERE a."worksheetId" = v."worksheetId"
  ),
  ARRAY[]::TEXT[]
)
WHERE v."closedAt" IS NOT NULL;

-- Journal entries: the author's current name.
UPDATE "WorksheetEntry" AS e
SET "authorName" = u."displayName"
FROM "User" AS u
WHERE e."authorId" = u."id";
