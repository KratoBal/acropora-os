-- The second model's flag (research plan v4, 7a 3.; S4): an independent model looked for a
-- discrepancy on a claim or an own conclusion. Append only: the API has no update or delete path.
-- Additive: a new enum and a new table, no existing row or column touched.
-- ROLLBACK: DROP TABLE "KnowledgeModelFlag"; DROP TYPE "KnowledgeModelFlagTarget";
-- CreateEnum
CREATE TYPE "KnowledgeModelFlagTarget" AS ENUM ('CLAIM', 'CONCLUSION');

-- CreateTable
CREATE TABLE "KnowledgeModelFlag" (
    "id" TEXT NOT NULL,
    "targetType" "KnowledgeModelFlagTarget" NOT NULL,
    "targetId" VARCHAR(64) NOT NULL,
    "targetHash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "runId" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "promptSha256" VARCHAR(64) NOT NULL,
    "flagged" BOOLEAN NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeModelFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeModelFlag_targetType_targetId_createdAt_idx" ON "KnowledgeModelFlag"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeModelFlag_runId_targetType_targetId_key" ON "KnowledgeModelFlag"("runId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "KnowledgeModelFlag" ADD CONSTRAINT "KnowledgeModelFlag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

