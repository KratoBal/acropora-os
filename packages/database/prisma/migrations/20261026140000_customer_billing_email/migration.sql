-- Számlázási e-mail az ügyfélen (Balázs, Acropora OS szál, 2026-10-26, msg 1564233255371280427 és
-- 1564233302561398886; acrobot 36173 és 36203): EGY rekord, KÉT cím. A "email" a rendelési cím marad, az új
-- "billingEmail" a számlázási; a kézi számla a számlázásira megy, ha az üres, az "email"-re.
--
-- A SZERVIZ PARTNER e-mailje beleolvad (Állatkert: a számla a vevő beszerzes@ címére ment, a partneren
-- pénzügy@ állt). CSAK a közvetlen tükör-kapcsolat (Supplier.customerId, PartnerWorksheetMirror) és csak a
-- szerviz partner (isService) számít, ugyanaz a hatókör, mint a folyamatos szinkroné (syncWorksheetMirror).
-- Az azonos adószám szerinti párosítás KIMARAD (acrobot 36203): a beszállító e-mailje az értékesítési vagy
-- rendelési kapcsolata, nem az a cím, ahova a NEKI kiállított számlát kell küldeni.
-- ÁLTALÁNOS ÉS IDEMPOTENS: ahol a (nem törölt, szerviz) partner e-mailje nem üres és ELTÉR a tükör-vevőjétől
-- (kis-nagybetű és körülvágás nélkül mérve), a partner címe a "billingEmail"-be kerül; a meglévő ügyfél
-- "email" SOHA nem változik; amelyik ügyfélnek már van "billingEmail"-je, azt nem írja felül (újrafutás: 0 sor).
--
-- A migráció maga írja ki a naplóba (RAISE NOTICE), hány sort érintett.
-- ROLLBACK: ALTER TABLE "Customer" DROP COLUMN "billingEmail"; (a "email" soha nem változott; a partner
-- e-mailje a Supplier.email-ben érintetlen maradt, tehát semmi sem vész el)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;

DO $$
DECLARE
  mirror_rows integer;
BEGIN
  WITH moved AS (
    UPDATE "Customer" c
    SET "billingEmail" = btrim(s."email")
    FROM "Supplier" s
    WHERE s."customerId" = c."id"
      AND s."isService"
      AND s."deletedAt" IS NULL
      AND btrim(coalesce(s."email", '')) <> ''
      AND lower(btrim(s."email")) <> lower(btrim(coalesce(c."email", '')))
      AND c."billingEmail" IS NULL
    RETURNING c."id"
  )
  SELECT count(*) INTO mirror_rows FROM moved;

  RAISE NOTICE 'customer_billing_email: % szerviz partner tukor-vevo kapott szamlazasi e-mailt', mirror_rows;
END $$;
