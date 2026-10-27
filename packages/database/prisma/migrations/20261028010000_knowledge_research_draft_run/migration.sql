-- Kutatasi tudastar, S6 B mod (terv v4, 7. pont es 9.2 S6; Balazs jovahagyasa 2026-10-23, Discord
-- 1563157803726798859, csak stage): a kutatasi tervezet egy futas eredmenye, ami percekig tart, ezert
-- a sor mar a futas alatt letezik (RUNNING), es egy elakadt lanc FAILED sorkent marad meg.
--
-- Ket uj enum-ertek, harom uj oszlop, ket oszlop nullazhatova valik. Meglevo sor nem valtozik (a
-- tabla a pilotban ures), backfill nincs: visszafele kompatibilis. Az uj ertekeket hasznalo index
-- es a CHECK a kovetkezo migracioban all: egy uj enum-ertek nem hasznalhato ugyanabban a tranzakcioban.
--
-- Visszaallitas (ures tablan): ALTER TABLE "KnowledgeResearchDraft" DROP COLUMN "report",
-- DROP COLUMN "heartbeatAt", DROP COLUMN "finishedAt"; a ket oszlop NOT NULL-ja vissza; az enum-ertekek
-- PostgreSQL-ben nem torolhetok, maradnak.

-- AlterEnum
ALTER TYPE "KnowledgeResearchDraftStatus" ADD VALUE 'RUNNING';
ALTER TYPE "KnowledgeResearchDraftStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "KnowledgeResearchDraft" ALTER COLUMN "summary" DROP NOT NULL,
ALTER COLUMN "summaryModel" DROP NOT NULL,
ADD COLUMN     "report" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "KnowledgeResearchDraft_status_idx" ON "KnowledgeResearchDraft"("status");
