-- The first live backfill round (2026-11-19) recorded NOT_FOUND for every number it asked (542 of 542, among them
-- 2026/00058, which is known to exist). The round had no control: nothing asked a number that certainly exists, so a
-- request that Számlázz.hu does not read and a number it does not know looked the same. From now on a NOT_FOUND is
-- recorded only after the highest stored number of the series was found in the same round; the answers recorded before
-- that carry no such proof, so they become UNVERIFIED (not final: the next dry round asks them again, and the page
-- counts them apart from the real "unknown" answers). Data only: no column or constraint changes.
UPDATE "SzamlazzFeedBackfillNumber"
SET "outcome" = 'UNVERIFIED',
    "detail" = 'ellenőrzésre vár: kontroll nélkül rögzített "nincs ilyen szám" (' || "detail" || ')'
WHERE "outcome" = 'NOT_FOUND';
