-- "Nem könyvelendő" jelölés a bejövő számlákon (Balázs, Acropora OS szál, 2026-10-26): kézi, egyenkénti
-- jelölés; a jelölt számla nem kerül a könyvelői anyagba, a hiányzó számlák számításába és a
-- kimutatásokba. Minden meglévő sor "könyvelendő" marad (false), tömeges adatmódosítás nincs.
-- ROLLBACK: ALTER TABLE "IncomingBillingDocument" DROP COLUMN "notBookable", DROP COLUMN "notBookableAt";
-- (csak a jelölések vesznek el, más adat nem függ tőle)
ALTER TABLE "IncomingBillingDocument" ADD COLUMN "notBookable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notBookableAt" TIMESTAMP(3);
