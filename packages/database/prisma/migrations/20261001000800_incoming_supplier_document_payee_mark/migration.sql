-- A szövegréteg nélküli számla vevőjének kézi jelölése (acrobot 25633).
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN "payeeMarkedAt" TIMESTAMP(3);
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN "payeeMarkedByUserId" TEXT;

-- A vevő-ellenőrzés a cég nevét is nézi, nem csak az adószámot (acrobot 25640:
-- a Magic Patterns amerikai számlája adószám nélkül NOT_COMPANY lett). A szöveg
-- alapján tárolt NOT_COMPANY ítéletek újraszámolódnak: NULL-ra állnak, és a
-- Hiányzó számlák következő olvasása egyszer újra ellenőrzi őket. A kézzel
-- jelöltekhez nem nyúlunk (ilyen ennél a migrációnál még nincs).
UPDATE "IncomingSupplierDocument"
SET "payeeCheck" = NULL
WHERE "payeeCheck" = 'NOT_COMPANY' AND "payeeMarkedAt" IS NULL;
