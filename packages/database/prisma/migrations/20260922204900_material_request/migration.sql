-- ANYAGIGENYLES A MUNKALAPROL -- Balazs szo szerinti kerese, 2026-09-22
-- 12:15:46 UTC: a szervizes munka kozben veszi eszre, hogy kell valami a
-- feladat elvegzesehez, felviszi a teteleket, es kulon "elkuld" gombbal
-- elkuldi. Errol keszul egy bejegyzes (ez a sor), es a "szerviz
-- anyagbeszerzes" jelolonegyzet birtokosai ertesulnek. Amikor a beszerzo
-- megjeloli a beerkezest, a kero es a munkalap MINDEN felelose (WorksheetAssignee)
-- ertesul.
--
-- A TELJES INDOKLAS A SEMABAN ALL (MaterialRequestStatus, MaterialRequest,
-- MaterialRequestItem, ServiceCapability fejlece): a lap-kotes (nem verzio),
-- a harom szabad szoveges tetel-mezo, a HAROM ALLAPOT (DRAFT -> OPEN ->
-- RECEIVED, ket kulon atmenettel, ket kulon ertesitesi korrel), es a ket
-- fuggetlen jelolo (ertesules vs. a beerkezes jelolese) mind Balazs vagy
-- acrobot kimondott dontesein allnak, datummal a semaban.

-- AlterEnum
--
-- Az `ALTER TYPE ... ADD VALUE` ugyanabban a tranzakcioban akkor biztonsagos,
-- ha a migracio az uj erteket NEM hasznalja DML-ben -- ez a migracio nem
-- hasznalja, ugyanaz az alak, mint a repo eddigi minden enum-bovitesenel.
ALTER TYPE "NotificationRole" ADD VALUE 'MATERIAL_REQUEST_CREATED';

-- CreateEnum
CREATE TYPE "ServiceCapability" AS ENUM ('MATERIAL_REQUEST_MARK_RECEIVED');

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'RECEIVED');

-- CreateTable
CREATE TABLE "UserServiceCapability" (
    "userId" TEXT NOT NULL,
    "capability" "ServiceCapability" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserServiceCapability_pkey" PRIMARY KEY ("userId","capability")
);

CREATE INDEX "UserServiceCapability_capability_idx" ON "UserServiceCapability"("capability");

ALTER TABLE "UserServiceCapability" ADD CONSTRAINT "UserServiceCapability_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialRequest_worksheetId_createdAt_idx" ON "MaterialRequest"("worksheetId", "createdAt");
CREATE INDEX "MaterialRequest_status_createdAt_idx" ON "MaterialRequest"("status", "createdAt");

ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_worksheetId_fkey"
  FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MaterialRequestItem" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialRequestItem_materialRequestId_position_key" ON "MaterialRequestItem"("materialRequestId", "position");

ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_materialRequestId_fkey"
  FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
