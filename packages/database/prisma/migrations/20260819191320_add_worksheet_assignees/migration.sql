-- Ki dolgozik a munkalapon. Kapcsolótábla és nem "assigneeId" oszlop: egy
-- lapnak több felelőse lehet. A kulcs a (munkalap, felhasználó) páros maga,
-- így ugyanaz az ember kétszer nem kerülhet fel ugyanarra a lapra.
--
-- Adatmigráció nincs: a tábla üresen indul. A ma létező lapoknak nincs
-- felelősük, és visszamenőleg kitalálni, kihez tartoztak volna, tévedés
-- lenne - a "createdById" azt mondja meg, ki VETTE FEL a lapot, nem azt,
-- ki dolgozott rajta.

-- CreateTable
CREATE TABLE "WorksheetAssignee" (
    "worksheetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "WorksheetAssignee_pkey" PRIMARY KEY ("worksheetId","userId")
);

-- CreateIndex
CREATE INDEX "WorksheetAssignee_userId_assignedAt_idx" ON "WorksheetAssignee"("userId", "assignedAt");

-- AddForeignKey
ALTER TABLE "WorksheetAssignee" ADD CONSTRAINT "WorksheetAssignee_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetAssignee" ADD CONSTRAINT "WorksheetAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetAssignee" ADD CONSTRAINT "WorksheetAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
