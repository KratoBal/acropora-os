-- KI MELYIK ALEGYSEGET LATJA -- A LATHATOSAGI HOZZARENDELES.
--
-- URES TABLARA MEGY, es ez nem feltevés: eles meres (Balazs futtatta, 2026-09-03
-- 07:19) szerint a rendszerben osszesen NEGY felhasznalo van, es EGYIKNEK SINCS
-- `supplierId` erteke. Nincs kit hozzarendelni, tehat nincs mit koltoztetni.
--
-- A KONTROLL, AMITOL EZ MERES ES NEM NULLA-TALALAT: ugyanabban a korben 16
-- alegyseg letezik, tehat a lekerdezes TUDOTT volna nem-nullat adni.
--
-- KAPCSOLOTABLA ES NEM MEZO: egy ember TOBB egyseget is kaphat (a dontes peldaja
-- PALMAHAZ es VARAZSHEGY egyszerre). Egy mezovel indulni a masodik egysegnel
-- adatbazis-koltoztetes lenne.

-- CreateTable
CREATE TABLE "UserWorksheetDepartment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWorksheetDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- A FORGALMAS UT: egy felhasznalo osszes hozzarendelese, minden jegy-listazasnal.
CREATE INDEX "UserWorksheetDepartment_userId_idx" ON "UserWorksheetDepartment"("userId");

-- CreateIndex
--
-- UGYANAZT AZ EGYSEGET KETSZER hozzarendelni ertelmetlen, es a duplikatum a
-- reszfa-bejarasban NEM okozna hibat -- csak ketszer jarna be ugyanazt. A hiba
-- tehat NEMA lenne, ezert all adatbazis-szinten.
CREATE UNIQUE INDEX "UserWorksheetDepartment_userId_departmentId_key" ON "UserWorksheetDepartment"("userId", "departmentId");

-- AddForeignKey
--
-- CASCADE mindket iranyban, es ez KULONBOZIK a naplotol: egy hozzarendeles nem
-- tortenelem, hanem AKTUALIS allapot. Ha a felhasznalo vagy az alegyseg
-- megszunik, a hozzarendelesnek nincs mit jelentenie.
ALTER TABLE "UserWorksheetDepartment" ADD CONSTRAINT "UserWorksheetDepartment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorksheetDepartment" ADD CONSTRAINT "UserWorksheetDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
