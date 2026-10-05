-- ÜZENETEK 4. FÁZIS: EGY ÉLŐ BESZÉLGETÉS MUNKALAPONKÉNT ÉS HIBAJEGYENKÉNT
-- (Balázs, 2026-10-05: „egy beszélgetés munkalaponként”). A `contextType` és a
-- `contextId` oszlop az 1. fázis óta áll, eddig semmi nem írta, tehát ez az
-- index meglévő sort nem érint. Két egyszerre megnyomott „Beszélgetés” gomb
-- közül így a második itt bukik el, és a szolgáltatás a már létezőt adja
-- vissza. Az archivált beszélgetés nem számít: utána újat lehet indítani.
-- A Prisma séma részleges indexet nem tud kifejezni, ezért nyers SQL
-- (előzmény: 20261005170000_webshop_parcel).
CREATE UNIQUE INDEX "Conversation_one_live_per_context_key"
  ON "Conversation"("contextType", "contextId")
  WHERE "contextId" IS NOT NULL AND "archivedAt" IS NULL;
