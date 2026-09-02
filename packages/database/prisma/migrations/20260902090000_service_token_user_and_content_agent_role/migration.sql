-- HOZZAADO MIGRACIO. Nincs benne oszlop-torles, tipus-szukites, sem adat-atiras.
--
-- A `userId` SZANDEKOSAN NULLAZHATO: a mar kiadott tokeneknek nincs
-- felhasznalojuk, es egy migracio nem talalhat ki nekik egyet. Az orzo dolga,
-- hogy egy felhasznalo nelkuli tokent ELUTASITSON, ne pedig valamilyen
-- alapertelmezett fiokra essen vissza.
--
-- AZ `ALTER TYPE ... ADD VALUE` TRANZAKCION BELUL: a PostgreSQL 12 ota
-- megengedett, amig az uj erteket ugyanabban a tranzakcioban nem HASZNALJUK --
-- ez a migracio nem hasznalja. A compose fajl `postgres:16-alpine` kepet
-- hasznal. AMI ALATAMASZTJA: ezt a harom utasitast beture a `prisma migrate
-- diff` allitotta elo a semabol, tehat a Prisma sajat, tamogatott alakja.
-- AMIT NEM MERTUNK: elo adatbazison nem futott le, mert a fejlesztoi
-- PostgreSQL ebben a kornyezetben nem erheto el.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CONTENT_AGENT';
-- AlterTable
ALTER TABLE "ServiceToken" ADD COLUMN     "userId" TEXT;
-- AddForeignKey
ALTER TABLE "ServiceToken" ADD CONSTRAINT "ServiceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
