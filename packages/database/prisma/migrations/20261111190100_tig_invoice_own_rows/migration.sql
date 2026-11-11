-- A MÁR KIÁLLÍTOTT TIG-SZÁMLÁK SAJÁT SORRÁ VÁLNAK (Balázs 2026-11-11 13:22 UTC). Ugyanaz, amit mostantól a kiállítás ír:
-- a forrás a teljesítési igazolás, és az e-számla jelölés (a TIG-számla `eszamla` nélkül, tehát e-számlaként ment ki,
-- és a sztornónak e-számlaként kell kérnie). Csak a kiállított sorok; a piszkozat és a folyamatban lévő forrás nélkül
-- marad, és nem érintünk sort, amelynek már van forrása.
--
-- ROLLBACK: before the code goes back, clear the new source: an older Prisma client is not built for a row with an
-- enum value it does not know:
--   UPDATE "Invoice" SET "sourceType" = NULL, "sourceId" = NULL WHERE "sourceType" = 'COMPLETION_CERTIFICATE';
-- The e-invoice mark (invoiceFormat ELECTRONIC) may stay: the older code does not read it on a TIG row. The enum
-- value stays too (previous migration).

UPDATE "Invoice"
SET "sourceType" = 'COMPLETION_CERTIFICATE',
    "sourceId" = "completionCertificateId",
    "invoiceFormat" = COALESCE("invoiceFormat", 'ELECTRONIC')
WHERE "completionCertificateId" IS NOT NULL
  AND "status" = 'ISSUED'
  AND "invoiceNumber" IS NOT NULL
  AND "sourceType" IS NULL;
