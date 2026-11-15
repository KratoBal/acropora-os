-- Card 1a35e8f3: grouped recording. Entries recorded from one form (the same template on several devices, one shared water meter)
-- carry the same groupId; each entry stays complete and standalone, the monthly report counts the group's meter difference once.
-- Additive: a nullable column and an index, no existing row changes.
ALTER TABLE "OperationsLogEntry" ADD COLUMN "groupId" VARCHAR(64);

CREATE INDEX "OperationsLogEntry_groupId_idx" ON "OperationsLogEntry"("groupId");
