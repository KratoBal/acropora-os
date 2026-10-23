-- Kutatasi tudastar, S2 szelet: a forras-felderito futasainak naploja (terv v4, 9.2 S2;
-- Balazs jovahagyasa 2026-10-23 11:51 UTC, Discord 1563157803726798859, csak stage).
--
-- Egy UJ enum, egy UJ (ures) tabla, es a KnowledgeSource egy UJ, nullazhato oszlopa
-- indexszel es idegen kulccsal. Meglevo sor nem valtozik, backfill nincs: visszafele
-- kompatibilis. A User csak Prisma-oldali visszahivatkozast kap.
--
-- Visszaallitas: ALTER TABLE "KnowledgeSource" DROP COLUMN "discoveryRunId";
-- DROP TABLE "KnowledgeDiscoveryRun"; DROP TYPE "KnowledgeDiscoveryRunStatus";

-- CreateEnum
CREATE TYPE "KnowledgeDiscoveryRunStatus" AS ENUM ('FINISHED', 'LIMIT_REACHED', 'INCOMPLETE');

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "discoveryRunId" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeDiscoveryRun" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "status" "KnowledgeDiscoveryRunStatus" NOT NULL,
    "input" JSONB NOT NULL,
    "queries" JSONB NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "sourcesCreated" INTEGER NOT NULL DEFAULT 0,
    "sourcesMatched" INTEGER NOT NULL DEFAULT 0,
    "versionsCreated" INTEGER NOT NULL DEFAULT 0,
    "claimsDisputed" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '{}',
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDiscoveryRun_requestedById_idx" ON "KnowledgeDiscoveryRun"("requestedById");

-- CreateIndex
CREATE INDEX "KnowledgeSource_discoveryRunId_idx" ON "KnowledgeSource"("discoveryRunId");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "KnowledgeDiscoveryRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDiscoveryRun" ADD CONSTRAINT "KnowledgeDiscoveryRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

