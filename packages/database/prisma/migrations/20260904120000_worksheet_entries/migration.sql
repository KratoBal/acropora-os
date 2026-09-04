-- A MUNKALAP MUNKANAPLOJA: mit csinalt a szerelo, sajat szavaival.
--
-- Balazs kerese, 2026-09-03, szo szerint: "legyen rajta egy bejegyzes nevu gomb
-- amire ha rakattint akkor szabadszavasan beirhatja, hogy mit csinalt. A vegen
-- rogzites gombbal. Ez tarolja el a bejegyzest, hogy ki keszitette es az
-- idopontot."
--
-- A MUNKALAPHOZ KOTODIK, NEM A VERZIOHOZ. Az alairas a verzioe, mert az egy
-- adott TARTALOM igazolasa; a bejegyzes NAPLO, arrol szol, mi tortent. Egy uj
-- verzio keszitese nem torolheti a munkanaplot -- a verziohoz kotve minden
-- modositas ujrakezdene a tortenetet.
--
-- ES NEM A `ServiceJobEvent` TABLABA KERUL, pedig annak van `note` mezoje,
-- aktora, idopontja, sot `worksheetId`-ja is. A kulonbseg szerkezeti: az a
-- tabla a HIBAJEGY ala van kotve, KOTELEZO `serviceJobId` mezovel es Cascade
-- torlessel. Egy hibajegy NELKULI munkalap tehat nem tudna bejegyzest
-- hordozni -- az pedig nem hibas eset, hanem az egyik rendes ut: a szerelo a
-- helyszinen felveszi a lapot, es a jegy nalunk szuletik meg utolag (a
-- `Worksheet.serviceJobId` sajat megjegyzese mondja ki). Oda teve a funkcio
-- CSENDBEN nem mukodne pont azokon a lapokon, amik a telefonon keletkeznek.
--
-- EZ A MIGRACIO MEGLEVO TABLAHOZ NEM NYUL: uj tabla, ket index, ket idegen
-- kulcs.

-- CreateTable
CREATE TABLE "WorksheetEntry" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- A lista mindig EGY lapra szol, idorendben: az index a parost fedi.
CREATE INDEX "WorksheetEntry_worksheetId_createdAt_idx" ON "WorksheetEntry"("worksheetId", "createdAt");

-- CreateIndex
-- A `SetNull` idegenkulcs ellenorzese MINDEN felhasznalo-torlesnel lefut, es
-- index nelkul vegigolvasna a tablat. Ugyanaz az indok, mint a `User`
-- partner-oszlopainal.
CREATE INDEX "WorksheetEntry_authorId_idx" ON "WorksheetEntry"("authorId");

-- AddForeignKey
-- CASCADE: a bejegyzes a lap resze, onallo ertelme nincs. Ha a lap eltunik, a
-- naploja is vele megy -- egy gazdatlan bejegyzes nem naplo, hanem szemet.
ALTER TABLE "WorksheetEntry" ADD CONSTRAINT "WorksheetEntry_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, ES EZ A LENYEG: egy tavozo kollega bejegyzese NEM tunhet el, mert
-- a naplo rola szol. A felulet kimondja, hogy a szerzo ismeretlen, nem elrejti
-- a sort.
ALTER TABLE "WorksheetEntry" ADD CONSTRAINT "WorksheetEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
