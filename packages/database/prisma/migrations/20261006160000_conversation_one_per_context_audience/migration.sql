-- A HIBAJEGY PARTNERES BESZÉLGETÉSE (kártya 084e2c24; Balázs, 2026-10-06
-- 12:36 UTC: „Mehet az 1-2”). Egy hibajegynek ezentúl KÉT élő beszélgetése
-- lehet: a belső (`INTERNAL`) és a partneres (`PARTNER`). Az előző index
-- (20261005200000) a közönségtől függetlenül egyet engedett, tehát a partneres
-- beszélgetés a belsővel ütközött volna. A közönség bekerül a kulcsba; a
-- feltétel változatlan, az archivált beszélgetés továbbra sem számít.
-- Meglévő sort nem érint: ma minden beszélgetés `INTERNAL`, és a régi index
-- ugyanezeken a sorokon már egyedi volt.
DROP INDEX "Conversation_one_live_per_context_key";

CREATE UNIQUE INDEX "Conversation_one_live_per_context_key"
  ON "Conversation"("contextType", "contextId", "audience")
  WHERE "contextId" IS NOT NULL AND "archivedAt" IS NULL;
