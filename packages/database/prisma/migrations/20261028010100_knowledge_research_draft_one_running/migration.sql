-- Kutatasi tudastar, S6 B mod, az elozo migracio folytatasa (az uj enum-ertek csak egy kovetkezo
-- tranzakcioban hasznalhato).
--
-- 1. Egyszerre egy futas: legfeljebb egy RUNNING sor (a Prisma semaban nem fejezheto ki), mint a
--    felderito es a kiolvaso futasnal.
-- 2. Egy DRAFT sor nem lehet osszefoglalo es az azt iro modell nelkul: a felulet a modell-szoveget
--    a modell nevevel jeloli, tehat a jeloles alapja nem hianyozhat.
--
-- Visszaallitas: DROP INDEX "KnowledgeResearchDraft_one_running_key";
-- ALTER TABLE "KnowledgeResearchDraft" DROP CONSTRAINT "KnowledgeResearchDraft_draft_has_summary";

CREATE UNIQUE INDEX "KnowledgeResearchDraft_one_running_key" ON "KnowledgeResearchDraft" ((true)) WHERE "status" = 'RUNNING';

ALTER TABLE "KnowledgeResearchDraft" ADD CONSTRAINT "KnowledgeResearchDraft_draft_has_summary"
  CHECK ("status" <> 'DRAFT' OR ("summary" IS NOT NULL AND "summaryModel" IS NOT NULL));
