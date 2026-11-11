-- A MÁR KIÁLLÍTOTT TIG-SZÁMLÁK FIZETÉSI MÓDJA (a 7ba97e0d kártya követője). Mostantól a kiállítás beírja, amit a
-- Számlázz.hu-nak küldött (`fizmod`); a régi sorokon üres, és a Számlázás részletek oldala üresen mutatta.
-- NEM TALÁLJUK KI (acrobot 47337): csak a Számlázz.hu saját feed-ikréből töltünk (ugyanaz a számlaszám), és csak ha
-- annak egyetlen, nem üres fizetési módja van. Ahol nincs iker, vagy az ikrek eltérnek, a sor üres marad.
-- A vevő-pillanatkép (buyerSnapshot) visszamenőleg nem tölthető: a kiállításkori vevőadat nincs meg.
--
-- ROLLBACK: nincs teendő. Az oszlop eddig is létezett, és a régi kód a TIG-soron csak kiírja.
-- A mérés, hány sor maradt forrás nélkül:
--   SELECT count(*) FROM "Invoice" WHERE "sourceType" = 'COMPLETION_CERTIFICATE' AND "status" = 'ISSUED' AND "paymentMethod" IS NULL;

UPDATE "Invoice" AS invoice
SET "paymentMethod" = twin."paymentMethod"
FROM (
    SELECT "documentNumber", MIN("paymentMethod") AS "paymentMethod"
    FROM "ExternalBillingDocument"
    WHERE "source" = 'SZAMLAZZ'
      AND "paymentMethod" IS NOT NULL
      AND btrim("paymentMethod") <> ''
    GROUP BY "documentNumber"
    HAVING COUNT(DISTINCT "paymentMethod") = 1
) AS twin
WHERE invoice."sourceType" = 'COMPLETION_CERTIFICATE'
  AND invoice."status" = 'ISSUED'
  AND invoice."paymentMethod" IS NULL
  AND invoice."invoiceNumber" = twin."documentNumber";
