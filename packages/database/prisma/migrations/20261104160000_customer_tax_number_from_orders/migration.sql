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
--   - a vevő-összevonás áll: a partner-tükörhöz és a partnerhez nem nyúlunk (a tükör a
--     partnerétől kapja, #2157).
-- Idempotens: második futásra már nincs üres cél.
--
-- A DARABSZÁM A POSTGRES SZERVER-NAPLÓJÁBA: egy WARNING-sor
--   VEVO-ADOSZAM-VISSZATOLTES kitoltve=N kimaradt_ellentmondas=M kimaradt_nem_magyar=K
-- Mérve 2026-11-04 (helyi Postgres): a `prisma migrate deploy` sem a NOTICE-t, sem a
-- WARNING-ot nem írja ki, és a NOTICE a szerver-naplóba sem kerül (log_min_messages
-- alapból warning); a WARNING igen. Nem hiba, csak így látszik.
DO $$
DECLARE
  filled integer;
  conflicting integer;
  not_hungarian integer;
BEGIN
  WITH order_tax AS (
    SELECT
      o."customerId" AS customer_id,
      btrim(o."buyerTaxNumber") AS tax,
      coalesce(o."orderedAt", o."createdAt") AS at
    FROM "SalesOrder" AS o
    JOIN "Customer" AS c ON c."id" = o."customerId"
    WHERE btrim(coalesce(o."buyerTaxNumber", '')) <> ''
      AND btrim(coalesce(c."taxNumber", '')) = ''
  ),
  hungarian AS (
    SELECT customer_id, tax, at, regexp_replace(tax, '[^0-9]', '', 'g') AS tax_key
    FROM order_tax
    WHERE tax ~ '^[0-9]{8}-?[0-9]-?[0-9]{2}$'
  ),
  per_customer AS (
    SELECT customer_id, count(DISTINCT tax_key) AS keys
    FROM hungarian
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
    (SELECT count(*) FROM updated),
    (SELECT count(*) FROM per_customer WHERE keys > 1),
    (SELECT count(DISTINCT customer_id) FROM order_tax
      WHERE customer_id NOT IN (SELECT customer_id FROM hungarian))
  INTO filled, conflicting, not_hungarian;
  RAISE WARNING 'VEVO-ADOSZAM-VISSZATOLTES kitoltve=% kimaradt_ellentmondas=% kimaradt_nem_magyar=%',
    filled, conflicting, not_hungarian;
END $$;
