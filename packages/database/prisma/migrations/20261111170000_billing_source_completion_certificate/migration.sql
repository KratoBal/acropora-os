-- A TELJESÍTÉSI IGAZOLÁSBÓL KIÁLLÍTOTT SZÁMLA FORRÁSA (Balázs 2026-11-11 13:22 UTC: a TIG-számlát a rendszer külső
-- számlának jelölte, és nem volt sztornózható). Csak az enum új értéke; a használata a következő migrációban van,
-- mert egy enumhoz adott értéket a PostgreSQL ugyanabban a tranzakcióban nem enged használni.

-- AlterEnum
ALTER TYPE "BillingSourceType" ADD VALUE 'COMPLETION_CERTIFICATE';
