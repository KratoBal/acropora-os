-- A VEVŐ ADÓSZÁMA A SAJÁT RENDELÉSEIBŐL, EGYSZER (kártya aaf4f09d; Balázs, 2026-11-04 11:58 UTC
-- „Mehet”, 14:24 UTC: „az unasban ott az adoszam csak nem hozta at”; acrobot 42470).
--
-- Az UNAS vevő-szinkron a számlázási cím adószámát beolvassa, de a vevőbe nem írja, ezért
-- az UNAS-ból jött vevő-sorok adószám nélkül állnak (az állatkert régi sora is). A rendelések
-- vevő-adószáma viszont az OS-ben van (`SalesOrder.buyerTaxNumber`, a vevőhöz `customerId`-vel
-- kötve). UNAS-hívás nincs, az UNAS-ba nem írunk.
--
-- A SZABÁLY:
--   - csak ÜRES `Customer.taxNumber` kap értéket, kitöltöttet nem írunk felül;
--   - csak magyar alakú adószám (8-1-2 számjegy, kötőjellel vagy anélkül), országkód nélkül;
--   - a vevő rendelésein álló adószámok közül ha EGY van (írásjel nélkül összevetve), a
--     legutóbbi rendelés alakja megy be; ha TÖBB különböző, a vevő kimarad (nem döntünk);
--   - a partner-tükör kimarad (`Supplier.customerId`): az adószámát a partnertől kapja (#2157),
--     egy rendelésből jövő érték a partner következő mentéséig ott maradna (barracuda, #2163);
--   - a MAGÁNSZEMÉLYNEK jelölt vevő (`PERSON`) kimarad, saját számlálóval: egy céges számlával
--     leadott rendelés adószáma nem a magánszemélyé, és a nevével együtt minden számlájára
--     kerülne (barracuda, #2163);
--   - a vevő-összevonás áll.
-- Idempotens: második futásra már nincs üres cél.
--
-- A DARABSZÁM AZ API NAPLÓJÁBA (acrobot 42502): a migráció egy `DomainEvent` sort ír
-- (`id` = `customer-tax-number-backfill-20261104`, `eventType` = `customer.tax-number-backfilled`),
-- és az API induláskor kiírja (`customer-tax-number-backfill.reporter.ts`). Mellette marad
-- egy WARNING-sor a Postgres szerver-naplójába:
--   VEVO-ADOSZAM-VISSZATOLTES kitoltve=N kimaradt_ellentmondas=M kimaradt_nem_magyar=K kimaradt_maganszemely=P
-- A VISSZAVONHATÓSÁG: az esemény a kitöltött vevők azonosítóit is tárolja (`filledIds`), így
-- egy hibás kitöltés célzottan visszavonható, és megkülönböztethető a kézitől.
-- Mérve 2026-11-04 (helyi Postgres): a `prisma migrate deploy` sem a NOTICE-t, sem a
-- WARNING-ot nem írja ki, és a NOTICE a szerver-naplóba sem kerül (log_min_messages
-- alapból warning); a WARNING igen. Nem hiba, csak így látszik.
DO $$
DECLARE
  filled_ids jsonb;
  conflicting integer;
  not_hungarian integer;
  persons integer;
BEGIN
  WITH order_tax AS (
    SELECT
      o."customerId" AS customer_id,
      c."type" = 'PERSON' AS is_person,
      btrim(o."buyerTaxNumber") AS tax,
      coalesce(o."orderedAt", o."createdAt") AS at
    FROM "SalesOrder" AS o
    JOIN "Customer" AS c ON c."id" = o."customerId"
    WHERE btrim(coalesce(o."buyerTaxNumber", '')) <> ''
      AND btrim(coalesce(c."taxNumber", '')) = ''
      AND NOT EXISTS (SELECT 1 FROM "Supplier" AS s WHERE s."customerId" = c."id")
  ),
  hungarian AS (
    SELECT customer_id, is_person, tax, at, regexp_replace(tax, '[^0-9]', '', 'g') AS tax_key
    FROM order_tax
    WHERE tax ~ '^[0-9]{8}-?[0-9]-?[0-9]{2}$'
  ),
  per_customer AS (
    SELECT customer_id, count(DISTINCT tax_key) AS keys
    FROM hungarian
    WHERE NOT is_person
    GROUP BY customer_id
  ),
  chosen AS (
    SELECT DISTINCT ON (h.customer_id) h.customer_id, h.tax
    FROM hungarian AS h
    JOIN per_customer AS p ON p.customer_id = h.customer_id AND p.keys = 1
    ORDER BY h.customer_id, h.at DESC
  ),
  updated AS (
    UPDATE "Customer" AS cu
    SET "taxNumber" = chosen.tax, "updatedAt" = now()
    FROM chosen
    WHERE cu."id" = chosen.customer_id
      AND btrim(coalesce(cu."taxNumber", '')) = ''
    RETURNING cu."id"
  )
  SELECT
    coalesce((SELECT jsonb_agg("id" ORDER BY "id") FROM updated), '[]'::jsonb),
    (SELECT count(*) FROM per_customer WHERE keys > 1),
    (SELECT count(DISTINCT customer_id) FROM order_tax
      WHERE customer_id NOT IN (SELECT customer_id FROM hungarian)),
    (SELECT count(DISTINCT customer_id) FROM hungarian WHERE is_person)
  INTO filled_ids, conflicting, not_hungarian, persons;
  INSERT INTO "DomainEvent" ("id", "eventType", "aggregateType", "aggregateId", "payload", "occurredAt")
  VALUES (
    'customer-tax-number-backfill-20261104',
    'customer.tax-number-backfilled',
    'Customer',
    'tax-number-backfill-20261104',
    jsonb_build_object(
      'filled', jsonb_array_length(filled_ids),
      'conflicting', conflicting,
      'notHungarian', not_hungarian,
      'persons', persons,
      'filledIds', filled_ids
    ),
    now()
  )
  ON CONFLICT ("id") DO NOTHING;
  RAISE WARNING 'VEVO-ADOSZAM-VISSZATOLTES kitoltve=% kimaradt_ellentmondas=% kimaradt_nem_magyar=% kimaradt_maganszemely=%',
    jsonb_array_length(filled_ids), conflicting, not_hungarian, persons;
END $$;
