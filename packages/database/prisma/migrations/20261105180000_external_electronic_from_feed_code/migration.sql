-- A KIMENŐ SZÁMLA ELEKTRONIKUS JELZŐJE A FEED KÓDJÁBÓL (task os-e-szamla-jelzo-migracio, acrobot 43724; a kód olvasása: #2241).
--
-- A Számlázz.hu kimenő számla feedjében az alap.eszamla egész kód (docs.szamlazz.hu, pénzügyi adatkapcsolat, kimenő számlák:
-- 0 nem számla, 1 papír, 2 és 3 e-számla). Az elemző a #2241 előtt az 1-et (a PAPÍR kódot) olvasta elektronikusnak, tehát a
-- már tárolt sorok jelzője fordított: az E-CRPR (kód 3) "Papír alapú", az ACRW (kód 1) "E-számla". Az elemző javítása csak az
-- ÚJ üzenetekre hat; ez a lépés a meglévő sorokat igazítja a nyers üzenethez, a telepítéssel magától (kézi lépés nincs).
--
-- HATÓKÖR: csak a source = 'SZAMLAZZ' sorok, a feedMessageId kapcsán a SZAMLAKI üzenetükhöz. Az eBIZ sor (source EBIZ)
-- és az a sor, amelynek nincs üzenete, vagy az üzenetben nincs számjegyes <eszamla> elem, MARAD, ahogy van.
-- IDEMPOTENS: csak az eltérő sort írja; újrafutás: 0 sor. A számla többi mezőjéhez nem nyúl.
-- A migráció maga írja ki a naplóba (RAISE NOTICE), hány sort érintett.
-- ROLLBACK: nem szükséges és nem is lehetséges visszafelé: a nyers üzenet a forrás, a billing:external-backfill (az
-- elemző javított alakjával) ugyanezt a sort építené újra.
DO $$
DECLARE
  moved_rows integer;
BEGIN
  WITH decided AS (
    SELECT
      d."id",
      substring(m."body" from '<eszamla>\s*([0-9]+)\s*</eszamla>') IN ('1', '2', '3') AS "isElectronic"
    FROM "ExternalBillingDocument" d
    JOIN "SzamlazzFeedMessage" m
      ON m."id" = d."feedMessageId"
    WHERE d."source" = 'SZAMLAZZ'
      AND m."body" ~ '<eszamla>\s*[0-9]+\s*</eszamla>'
  ), moved AS (
    UPDATE "ExternalBillingDocument" d
    SET "electronic" = decided."isElectronic"
    FROM decided
    WHERE d."id" = decided."id"
      AND d."electronic" IS DISTINCT FROM decided."isElectronic"
    RETURNING d."id"
  )
  SELECT count(*) INTO moved_rows FROM moved;
  RAISE NOTICE 'ExternalBillingDocument.electronic a feed eszamla kódjából: % sor módosítva', moved_rows;
END $$;
