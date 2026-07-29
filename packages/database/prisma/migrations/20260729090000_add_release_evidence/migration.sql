-- CreateEnum: a checkpoint-7 release-evidence modellhez - ma egyetlen
-- érték (INVENTORY_POSTGRES_CONCURRENCY_TEST), lásd a schema.prisma-beli
-- doc-commentet.
CREATE TYPE "ReleaseEvidenceType" AS ENUM ('INVENTORY_POSTGRES_CONCURRENCY_TEST');

-- CreateEnum
CREATE TYPE "ReleaseEvidenceStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable: gépileg olvasható, kizárólag hiteles CI/release-folyamat
-- által írható bizonyíték - lásd
-- packages/database/scripts/record-release-evidence.ts (nincs HTTP
-- endpoint, ami ide írhatna) és a schema.prisma-beli modell doc-commentjét.
CREATE TABLE "ReleaseEvidence" (
    "id" TEXT NOT NULL,
    "evidenceType" "ReleaseEvidenceType" NOT NULL,
    "status" "ReleaseEvidenceStatus" NOT NULL,
    "commitSha" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "databaseEngine" TEXT NOT NULL,
    "databaseEngineVersion" TEXT NOT NULL,
    "testSuite" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "resultDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseEvidence_evidenceType_commitSha_status_idx" ON "ReleaseEvidence"("evidenceType", "commitSha", "status");

-- CreateIndex
CREATE INDEX "ReleaseEvidence_evidenceType_createdAt_idx" ON "ReleaseEvidence"("evidenceType", "createdAt");
