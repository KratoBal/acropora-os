-- NAPI ELLENŐRZÉS, CSAK OLVAS (kártya aaf4f09d; Balázs, 2026-11-04 12:22 UTC: „Én azt szeretném, hogy soha többet ne
-- fordulhasson elő ilyen"; acrobot 42299). A tegnapi (budapesti naptári nap) KIÁLLÍTOTT számlák, ahol a vevőnek adószám
-- kellett volna, és a kiküldött adat szerint nem volt. acrobot futtatja a flotta csak olvasó útján (fleet_ro), ütemezve.
--
-- A SZABÁLY UGYANAZ, MINT A KIÁLLÍTÁS KAPUJÁBAN (apps/api/src/integrations/szamlazz/szamlazz-buyer-tax.ts,
-- `buyerNeedsTaxNumber`): adószám kell, HACSAK a vevő nincs kifejezetten magánszemélynek (PERSON) jelölve; a partnerhez
-- kötött vevő (vevő-tükör) mindig kér; a magánszemélynek jelölt, de cégformájú nevű vevő is kér. Az üres vagy ismeretlen
-- típus nem magánszemély. A cégforma-lista ugyanaz, mint ott (`ORGANIZATION_NAME_MARKERS`; a spec méri).
--
-- Az adószám a KIKÜLDÖTT pillanatképből (`buyerSnapshot`), ha nincs, a bizonylat partner-adószámából (a Számlázz.hu
-- feedből jött, nem az OS-ből kiállított számláknál). Így az OS-en kívül kiállított számlát is látja.
--
-- Kimenet: számlaszám, kiállítás napja, vevő neve, vevő-típus, partnerhez kötött-e.
SELECT
  i."invoiceNumber" AS szamlaszam,
  (i."issueDate" AT TIME ZONE 'Europe/Budapest')::date AS kiallitas_napja,
  coalesce(i."buyerSnapshot"->>'name', i."partnerName") AS vevo_neve,
  c."type"::text AS vevo_tipus,
  (s."id" IS NOT NULL) AS partnerhez_kotott
FROM "Invoice" AS i
LEFT JOIN "Customer" AS c ON c."id" = i."customerId"
LEFT JOIN "Supplier" AS s ON s."customerId" = i."customerId"
WHERE i."status" = 'ISSUED'
  AND (i."issueDate" AT TIME ZONE 'Europe/Budapest')::date = (now() AT TIME ZONE 'Europe/Budapest')::date - 1
  -- a sztornó az eredeti vevőjét ismétli: az eredeti számla már jelez
  AND i."documentType"::text <> 'STORNO'
  AND btrim(coalesce(i."buyerSnapshot"->>'taxNumber', i."partnerTaxNumber", '')) = ''
  AND btrim(coalesce(i."buyerSnapshot"->>'euTaxNumber', '')) = ''
  AND (
    s."id" IS NOT NULL
    OR c."type" IS DISTINCT FROM 'PERSON'
    OR coalesce(i."buyerSnapshot"->>'name', i."partnerName", '') ~* '(^|[^[:alnum:]])(kft|zrt|nyrt|rt|bt|kkt|kht|nonprofit|ev|e\.v|egyéni vállalkozó|alapítvány|egyesület|önkormányzat|gmbh|ltd|s\.r\.o)\.?($|[^[:alnum:]])'
  )
ORDER BY i."issueDate", i."invoiceNumber";
