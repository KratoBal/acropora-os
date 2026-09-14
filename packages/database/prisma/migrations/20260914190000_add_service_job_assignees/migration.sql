-- Ki dolgozik a hibajegyen. Kapcsolótábla és nem "assignedUserId" oszlop: egy
-- jegyre több szervizes kolléga is delegálható. A kulcs a (jegy, felhasználó)
-- páros maga, így ugyanaz az ember kétszer nem kerülhet fel ugyanarra a jegyre.
--
-- Adatmigráció nincs: a tábla üresen indul. A ma létező jegyeken a régi
-- "assignedUserId" oszlop áll, azt viszont a kód SEHOL nem írja és nem is
-- olvassa (mérve 2026-09-14, nulla találat a teljes TypeScript fán, pozitív
-- kontrollal), tehát nincs mit áttölteni. Az oszlop eldobása külön döntés és
-- külön migráció: visszafordíthatatlanul adatot venne el, és a mérésem a
-- KÓDRÓL szól, nem az adatbázis tartalmáról.

-- CreateTable
CREATE TABLE "ServiceJobAssignee" (
    "serviceJobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "ServiceJobAssignee_pkey" PRIMARY KEY ("serviceJobId","userId")
);

-- CreateIndex
CREATE INDEX "ServiceJobAssignee_userId_assignedAt_idx" ON "ServiceJobAssignee"("userId", "assignedAt");

-- AddForeignKey
ALTER TABLE "ServiceJobAssignee" ADD CONSTRAINT "ServiceJobAssignee_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobAssignee" ADD CONSTRAINT "ServiceJobAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobAssignee" ADD CONSTRAINT "ServiceJobAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
