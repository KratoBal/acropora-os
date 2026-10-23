-- Kutatasi tudastar, S3 szelet: a kiolvaso futasainak naploja, es a szerkesztoi kerdes
-- helye a mezo-horgonyon (terv v4, 9.2 S3; Balazs jovahagyasa 2026-10-23, Discord
-- 1563157803726798859, csak stage).
--
-- Egy UJ enum, egy UJ (ures) tabla, es a KnowledgeFieldAnchor egy UJ, nullazhato oszlopa.
-- Meglevo sor nem valtozik, backfill nincs: visszafele kompatibilis.
-- Egyszerre egy RUNNING kiolvaso futas: a vegen allo reszleges egyedi index tartja.
--
-- Visszaallitas: ALTER TABLE "KnowledgeFieldAnchor" DROP COLUMN "proposedValue";
-- DROP TABLE "KnowledgeExtractionRun"; DROP TYPE "KnowledgeExtractionRunStatus";

-- CreateEnum
CREATE TYPE "KnowledgeExtractionRunStatus" AS ENUM ('RUNNING', 'FINISHED', 'FAILED');

-- AlterTable
ALTER TABLE "KnowledgeFieldAnchor" ADD COLUMN     "proposedValue" VARCHAR(64);

-- CreateTable
CREATE TABLE "KnowledgeExtractionRun" (
    "id" TEXT NOT NULL,
    "status" "KnowledgeExtractionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "sourceIds" TEXT[],
    "report" JSONB NOT NULL DEFAULT '{}',
    "claimsCreated" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeExtractionRun_requestedById_idx" ON "KnowledgeExtractionRun"("requestedById");

-- CreateIndex
CREATE INDEX "KnowledgeExtractionRun_status_idx" ON "KnowledgeExtractionRun"("status");

-- AddForeignKey
ALTER TABLE "KnowledgeExtractionRun" ADD CONSTRAINT "KnowledgeExtractionRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Egyszerre egy futas: legfeljebb egy RUNNING sor (a Prisma semaban nem fejezheto ki).
CREATE UNIQUE INDEX "KnowledgeExtractionRun_one_running_key" ON "KnowledgeExtractionRun" ((true)) WHERE "status" = 'RUNNING';
