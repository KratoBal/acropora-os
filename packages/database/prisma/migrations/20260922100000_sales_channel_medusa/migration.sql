-- A Medusa-bolt rendelésének SAJÁT csatorna-értéke.
--
-- Az indoklás a schema.prisma-ban áll: az `API` érték azt mondja, hogy külső
-- hívó hozta létre a rendelést, a `MEDUSA` azt, hogy MELYIK bolt. A származás
-- dönti el, hova megy vissza az állapot és kinek a készlete fogy, ezért nem az
-- `API` alá került.
--
-- Ez a migráció EGYETLEN meglévő sort sem ír át: csak egy új felsorolás-értéket
-- vesz fel, amit ma egyetlen sor sem visel.
--
-- Az `ALTER TYPE ... ADD VALUE` ugyanabban a tranzakcióban akkor biztonságos, ha
-- a migráció az új értéket nem is használja DML-ben -- itt nem használja. Ugyanez
-- az alak áll a repó eddigi enum-bővítéseiben.

-- AlterEnum
ALTER TYPE "SalesChannel" ADD VALUE 'MEDUSA';
