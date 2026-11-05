-- A BEJÖVŐ SZÁMLA ELEKTRONIKUS JELZŐJE A FEED KÓDJÁBÓL (task os-e-szamla-jelzo-bejovo, acrobot 43735; a kimenő párja:
-- 20261105180000_external_electronic_from_feed_code).
--
-- A bejövő feed (SZAMLABE) alap.eszamla mezője ugyanaz az egész kód: a mért eloszlás (acrobot, 2026-11-05): 1 az 81 db (papír
-- beszállítók: OBI, SOPRO, HANNA), 2 a 74 db (Telekom, Foxpost, GLS, OTP eBIZ: e-számla), 3 a 17 db (mind E- előtagú
-- Számlázz.hu-s kiállító); 0 és hiányzó elem nincs. A kimenő feed dokumentációja szerint 0 nem számla, 1 papír, 2 és 3 e-számla; a
-- bejövő oldal dokumentációja a kódok jelentését nem írja le, a mért minta egyezik a kimenővel. Az elemző a javításig az 1-et
-- (a PAPÍR kódot) olvasta elektronikusnak, tehát a tárolt sorok jelzője fordított; ez a lépés a meglévő sorokat igazítja a nyers
-- üzenethez, a telepítéssel magától (kézi lépés nincs).
--
-- HATÓKÖR: csak a source = 'SZAMLAZZ' sorok, a feedMessageId kapcsán a SZAMLABE üzenetükhöz. Az a sor, amelynek nincs üzenete,
-- vagy az üzenetben nincs számjegyes <eszamla> elem, MARAD, ahogy van. IDEMPOTENS: csak az eltérő sort írja; újrafutás: 0 sor.
-- A migráció maga írja ki a naplóba (RAISE NOTICE), hány sort érintett.
-- ROLLBACK: nem szükséges és nem lehetséges visszafelé: a nyers üzenet a forrás, a billing:incoming-backfill (az elemző
-- javított alakjával) ugyanezt a sort építené újra.
DO $$
DECLARE
  moved_rows integer;
BEGIN
  WITH decided AS (
    SELECT
      d."id",
      substring(m."body" from '<eszamla>\s*([0-9]+)\s*</eszamla>') IN ('2', '3') AS "isElectronic"
    FROM "IncomingBillingDocument" d
    JOIN "SzamlazzFeedMessage" m
      ON m."id" = d."feedMessageId" AND m."kind" = 'SZAMLABE'
    WHERE d."source" = 'SZAMLAZZ'
      AND m."body" ~ '<eszamla>\s*[0-9]+\s*</eszamla>'
  ), moved AS (
    UPDATE "IncomingBillingDocument" d
    SET "electronic" = decided."isElectronic"
    FROM decided
    WHERE d."id" = decided."id"
      AND d."electronic" IS DISTINCT FROM decided."isElectronic"
    RETURNING d."id"
  )
  SELECT count(*) INTO moved_rows FROM moved;
  RAISE NOTICE 'IncomingBillingDocument.electronic a feed eszamla kódjából: % sor módosítva', moved_rows;
END $$;
