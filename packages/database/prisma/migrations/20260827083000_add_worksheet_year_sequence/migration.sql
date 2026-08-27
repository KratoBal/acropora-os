-- A munkalapszam sorozata evenkent EGY szamlalo, az egesz cegre (tulajdonosi
-- dontes, 2026-08-25: a szambol a partner tagja kimarad, mert a lap cime mar
-- azonositja a partnert).
--
-- KULON TABLA, es NEM a regi ket kodmezoje nullazhatova teve: az a kezenfekvo
-- alak ugyanaz a csapda lenne, mint a helyszin-fanal -- a Postgresben a NULL
-- nem egyenlo onmagaval, tehat a @@unique a globalis soron nem erne semmit, es
-- ket parhuzamos lezaras ket szamlalo-sort hozna letre ugyanarra az evre.
--
-- A regi "WorksheetNumberSequence" ERINTETLEN marad: a benne allo kurzorok a
-- regi, partneres sorozatokat irjak le, es azok visszakeresheto k maradnak. A
-- ket sorozat szamai NEM tudnak utkozni, mert a regi szam alakja mas
-- (FANK-BIO-2026-001 kontra BIO-2026-001), tehat az uj szamlalo 1-rol indulhat.

-- CreateTable
CREATE TABLE "WorksheetYearSequence" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetYearSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetYearSequence_year_key" ON "WorksheetYearSequence"("year");
