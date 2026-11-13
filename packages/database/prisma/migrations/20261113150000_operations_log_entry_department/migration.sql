-- AlterTable
ALTER TABLE "OperationsLogEntry" ADD COLUMN     "departmentId" TEXT;

-- Backfill: the department the asset stands in now is the best available record for the entries already written.
UPDATE "OperationsLogEntry" AS e
SET "departmentId" = a."departmentId"
FROM "Asset" AS a
WHERE a."id" = e."assetId" AND a."departmentId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "OperationsLogEntry_departmentId_startedAt_idx" ON "OperationsLogEntry"("departmentId", "startedAt");

-- AddForeignKey
ALTER TABLE "OperationsLogEntry" ADD CONSTRAINT "OperationsLogEntry_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

