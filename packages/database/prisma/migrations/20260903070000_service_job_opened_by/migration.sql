-- KI NYITOTTA A JEGYET -- ALLITAS A JEGYEN, NEM KOVETKEZTETES A NAPLOBOL.
--
-- A nyito eddig csak a naplo elso sorabol (`toStatus = 'NEW'`) volt kiolvashato.
-- Harom dolog miatt kap sajat mezot, es mind a harom NEMAN rontott volna:
--
--   1. a naplo aktora `SetNull` a felhasznalo torlesekor -- helyesen, mert a
--      naplo nem hazudhat arrol, ki lepett. De egy torolt kollega VEVO NELKULI
--      jegye igy senkinek nem latszott volna.
--   2. a `ServiceJobEvent` egyetlen indexe `[serviceJobId, createdAt]`, tehat a
--      lathatosagi szures indexeletlen oszlopra ment volna.
--   3. a naplo aktora azt mondja meg, KI IRTA BE az elso sort, nem azt, KIE a
--      jegy. Ma egybeesik; egy masodik keletkezesi ut eseten szetvalna.

-- AlterTable
ALTER TABLE "ServiceJob" ADD COLUMN     "openedById" TEXT;

-- A MEGLEVO SOROK FELTOLTESE A KELETKEZES ESEMENYEBOL.
--
-- A `toStatus = 'NEW'` azonositja a keletkezest, es ez BIZONYITHATO, nem
-- heurisztika: az atmenet-tabla (`service-job-transitions.ts`) szerint a NEW-ba
-- EGYETLEN atmenet sem vezet, csak forraskent szerepel. Tehat ilyen sor jegyenkent
-- legfeljebb egy van.
--
-- AHOL AZ AKTOR MAR `NULL`, OTT NULL MARAD, es ez nem mulasztas: azt a kollegat
-- azota toroltek, es a naplo `SetNull`-ja mar elvette a nevet. Egy talalgatott
-- ertek (peldaul "az elso ismert aktor") itt rosszabb lenne a hianynal.
--
-- A `LIMIT 1` es a `createdAt` szerinti rendezes akkor is helyes valaszt ad, ha
-- egy jegyen valaha tobb NEW-sor allna: a LEGKORABBIT veszi.
UPDATE "ServiceJob" j
SET "openedById" = (
  SELECT e."actorUserId"
  FROM "ServiceJobEvent" e
  WHERE e."serviceJobId" = j."id"
    AND e."toStatus" = 'NEW'
  ORDER BY e."createdAt" ASC
  LIMIT 1
);

-- CreateIndex
--
-- A LATHATOSAG MINDEN partner-oldali lekerdezesnel ezen az oszlopon szur, tehat
-- ez nem "hatha" index. Ugyanaz az alak, amit harom rokon tabla mar visel:
-- `AuditLog` a `userId`-n, `AssetEvent` es `StockReconciliationRepair` az
-- `actorUserId`-n.
CREATE INDEX "ServiceJob_openedById_idx" ON "ServiceJob"("openedById");

-- ES NINCS IDEGENKULCS, szandekosan. Egy `SET NULL` kulcs pontosan azt a
-- vesztesget hozna vissza, ami elol ez a mezo kiter: a torolt kollega jegye
-- ujra elveszitene a nyitojat. Ugyanez all az `assignedUserId` oszlopon is.
