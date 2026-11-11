-- A TELJESÍTÉSI IGAZOLÁSBÓL KIÁLLÍTOTT SZÁMLA FORRÁSA (Balázs 2026-11-11 13:22 UTC: a TIG-számlát a rendszer külső
-- számlának jelölte, és nem volt sztornózható). Csak az enum új értéke; a használata a következő migrációban van,
-- mert egy enumhoz adott értéket a PostgreSQL ugyanabban a tranzakcióban nem enged használni.
--
-- ROLLBACK: the value cannot be dropped by itself (the type would have to be rebuilt), and it does not need to be: it
-- stays, unused. What the rollback undoes is its use, in the next migration (see its ROLLBACK line).

-- AlterEnum
ALTER TYPE "BillingSourceType" ADD VALUE 'COMPLETION_CERTIFICATE';
