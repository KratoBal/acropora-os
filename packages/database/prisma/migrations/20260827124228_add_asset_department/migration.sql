-- Az eszkoz a partner ALEGYSEGEHEZ kotheto (a Fank „Biodom" egysege).
--
-- NULLAZHATO, es a meglevo sorok NULL ertekkel maradnak: nem tudjuk, melyik
-- alegysegben allnak, es nem is talaljuk ki. Az adatlapjukon a partner postai
-- cime latszik tovabbra is, jelolve, hogy ez visszaeses, nem valasztas.
--
-- RESTRICT, nem SET NULL: egy alegyseg torlese nem veheti el csendben egy
-- eszkoz helyet. Alegyseg-torlesre ma nincs is ut a rendszerben (merve
-- 2026-08-27), es ha lesz, elobb a rajta logo eszkozoket kell elmozditani.
--
-- Ugyanaz a sor, ami a munkalapszam elso tagjat adja: a partner kepernyon
-- „Alegysegek", a munkalapnal `departmentId`, tehat itt is az.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "Asset_departmentId_idx" ON "Asset"("departmentId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
