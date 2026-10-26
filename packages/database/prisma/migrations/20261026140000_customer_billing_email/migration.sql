-- Számlázási e-mail az ügyfélen (Balázs, Acropora OS szál, 2026-10-26, msg 1564233255371280427 és
-- 1564233302561398886; acrobot 36173): EGY rekord, KÉT cím. A "email" a rendelési cím marad, az új
-- "billingEmail" a számlázási; a kézi számla a számlázásira megy, ha az üres, az "email"-re.
--
-- A partner e-mailje beleolvad (Állatkert: a számla a vevő beszerzes@ címére ment, a partneren pénzügy@
-- állt). ÁLTALÁNOS ÉS IDEMPOTENS: ahol a (nem törölt) partner e-mailje nem üres és ELTÉR az ügyfélétől
-- (kis-nagybetű és körülvágás nélkül mérve), a partner címe a "billingEmail"-be kerül; a meglévő ügyfél
-- "email" SOHA nem változik; amelyik ügyfélnek már van "billingEmail"-je, azt nem írja felül (újrafutás: 0 sor).
-- Két ügyfélsor érintett: (1) a szerviz partner tükör-vevője (Supplier.customerId), (2) az ugyanazon céghez
-- tartozó, nem tükör ügyfél (az adószám első 8 számjegye egyezik). Amelyik ügyfélhez több partner illik,
-- ott a legkisebb azonosítójú partner címe nyer (determinista).
--
-- A migráció maga írja ki a naplóba (RAISE NOTICE), hány sort érintett, soronként a két esetre.
-- ROLLBACK: ALTER TABLE "Customer" DROP COLUMN "billingEmail"; (a "email" soha nem változott; a partner
-- e-mailje a Supplier.email-ben érintetlen maradt, tehát semmi sem vész el)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;

DO $$
DECLARE
  mirror_rows integer;
  buyer_rows integer;
BEGIN
  WITH moved AS (
    UPDATE "Customer" c
    SET "billingEmail" = btrim(s."email")
    FROM "Supplier" s
    WHERE s."customerId" = c."id"
      AND s."deletedAt" IS NULL
      AND btrim(coalesce(s."email", '')) <> ''
      AND lower(btrim(s."email")) <> lower(btrim(coalesce(c."email", '')))
      AND c."billingEmail" IS NULL
    RETURNING c."id"
  )
  SELECT count(*) INTO mirror_rows FROM moved;

  WITH picked AS (
    SELECT DISTINCT ON (c."id") c."id" AS customer_id, btrim(s."email") AS partner_email
    FROM "Customer" c
    JOIN "Supplier" s
      ON length(left(regexp_replace(coalesce(c."taxNumber", ''), '[^0-9]', '', 'g'), 8)) = 8
     AND left(regexp_replace(coalesce(c."taxNumber", ''), '[^0-9]', '', 'g'), 8)
       = left(regexp_replace(coalesce(s."taxNumber", ''), '[^0-9]', '', 'g'), 8)
    WHERE s."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Supplier" m WHERE m."customerId" = c."id")
      AND btrim(coalesce(s."email", '')) <> ''
      AND lower(btrim(s."email")) <> lower(btrim(coalesce(c."email", '')))
      AND c."billingEmail" IS NULL
    ORDER BY c."id", s."id"
  ),
  moved AS (
    UPDATE "Customer" c
    SET "billingEmail" = picked.partner_email
    FROM picked
    WHERE c."id" = picked.customer_id
    RETURNING c."id"
  )
  SELECT count(*) INTO buyer_rows FROM moved;

  RAISE NOTICE 'customer_billing_email: % szerviz partner tukor-vevo, % azonos ceg vevokent kapott szamlazasi e-mailt', mirror_rows, buyer_rows;
END $$;
