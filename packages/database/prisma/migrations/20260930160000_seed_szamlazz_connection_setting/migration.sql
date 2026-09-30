-- A Számlázz.hu kapcsolat EGYETLEN beállítás-sora (id 'szamlazz').
--
-- A 20260724130000-es migráció a táblát létrehozta, a sort viszont nem: a NAV
-- (20260730110000), a UNAS (20260720210000) és a Medusa (20260825111755)
-- ugyanabban a migrációban szúrja be a sajátját, ez kimaradt. A kód nem hoz
-- létre sort (a repository findUnique és update), tehát üres táblán minden
-- kulcs-mentés SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING-gel állt meg (Balázs a
-- stage-en, 2026-09-30; élesen és a stage-en is üres volt a tábla).
--
-- ON CONFLICT DO NOTHING: a stage-en acrobot 2026-09-30-án kézzel beszúrta a
-- sort, hogy Balázs haladni tudjon. Ott ez a migráció nem ír semmit, és a
-- kézzel mentett kulcsot sem írja felül. Meglévő sort nem változtat.
INSERT INTO "SzamlazzConnectionSetting" (
  "id",
  "credentialMode",
  "updatedAt"
) VALUES (
  'szamlazz',
  'ENV_FALLBACK',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
