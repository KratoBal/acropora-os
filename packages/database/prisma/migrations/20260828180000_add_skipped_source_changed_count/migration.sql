-- A KIHAGYAS ONMAGABAN NEM JELZES, MERT ALLANDO.
--
-- A `skippedCount` minden futasnal ugyanazokat a termekeket szamolja: azokat,
-- amiknek a torzsadatat mar nem a UNAS gondozza. Ez a szam futasrol futasra
-- ugyanaz, es egy szam, ami sosem valtozik, nem jelzes, hanem alapzaj.
--
-- EZ AZ OSZLOP ESEMENYT SZAMOL: a kihagyottak kozul azokat, amiknel a FORRAS IS
-- valtozott ugyanabban a futasban. Vagyis a boltban atirtak egy termeket,
-- amit mi vettunk at, es a valtozas nem jott at. A legtobb futason nulla.
--
-- A `skippedCount` jelentese NEM valtozik: mar tarolt adat, es a ket szam ket
-- kulonbozo kerdesre valaszol.
--
-- Az alapertelmezes nulla, es a meglevo sorok is azt kapjak. Ez NEM azt
-- allitja, hogy azoknal a futasoknal nem tortent elavulas: azt allitja, hogy
-- nem mertuk. A kettot a sor datuma valasztja el ettol a migraciotol.
ALTER TABLE "UnasProductSyncRun"
  ADD COLUMN "skippedSourceChangedCount" INTEGER NOT NULL DEFAULT 0;
