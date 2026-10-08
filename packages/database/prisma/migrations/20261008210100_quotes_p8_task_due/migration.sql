-- #1582 P8: a task's due date. A nullable column: the existing tasks keep
-- none, and their order on the board is unchanged.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_dueAt_idx" ON "Task"("assigneeId", "status", "dueAt");

