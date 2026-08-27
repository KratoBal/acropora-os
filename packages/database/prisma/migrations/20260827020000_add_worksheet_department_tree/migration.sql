-- A szervizpartner helyszinei FA szerkezetuek lesznek (Balazs dontese,
-- 2026-08-25 20:37): tobb szint, nem ket rogzitett. A meglevo sorok
-- `parentId`-je NULL marad, tehat a mai lapos lista a fa ELSO SZINTJE lesz --
-- adatvesztes es atszamozas nelkul, es a mai munkalapok hivatkozasai
-- valtozatlanok.

-- AlterTable
ALTER TABLE "WorksheetDepartment" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "WorksheetDepartment_parentId_idx" ON "WorksheetDepartment"("parentId");

-- A KODOK TESTVEREK KOZOTT EGYEDIEK. Ket kulonbozo ag alatt ugyanaz a kod
-- (`BIO`) megengedett; egy szulon belul nem.
-- CreateIndex
CREATE UNIQUE INDEX "WorksheetDepartment_customerId_parentId_code_key" ON "WorksheetDepartment"("customerId", "parentId", "code");

-- ES ITT A LENYEG, AMI NELKUL A MAI GARANCIA CSENDBEN ELVESZNE.
--
-- A fenti megkotes a LEGFELSO szintre NEM er: a Postgresben a NULL nem egyenlo
-- onmagaval, tehat ket gyoker-sor AZONOS koddal atmenne rajta. Eddig a
-- `WorksheetDepartment_customerId_code_key` tiltotta ezt, es azt a kovetkezo
-- sor ejti el -- vagyis csere nelkul a partneren belul ket "BIO" nevu helyszin
-- keletkezhetne, es errol semmi nem szolna.
--
-- A Prisma sema RESZLEGES egyedi indexet nem tud kifejezni, ezert all itt
-- nyers SQL-kent. A ketto egyutt adja azt, amit eddig egy megkotes adott.
CREATE UNIQUE INDEX "WorksheetDepartment_customer_root_code_key" ON "WorksheetDepartment"("customerId", "code") WHERE "parentId" IS NULL;

-- DropIndex
DROP INDEX "WorksheetDepartment_customerId_code_key";

-- AddForeignKey
ALTER TABLE "WorksheetDepartment" ADD CONSTRAINT "WorksheetDepartment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorksheetDepartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
