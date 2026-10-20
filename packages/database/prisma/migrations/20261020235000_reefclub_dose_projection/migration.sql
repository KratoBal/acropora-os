-- ReefClub, slice 8 (task reefclub-szelet-8-vetites, plan v6.1 section 6.2, path B decided with
-- acrobot and barracuda on 2026-10-20): the projection of the product dose list for the ReefClub
-- role, which may not read the product tables. Additive only: two new tables and one new enum; no
-- existing table or column changes. The OS process fills them (a full rebuild in one transaction);
-- the ReefClub role only reads.
-- ROLLBACK: drop the tables ReefClubDoseRow and ReefClubDoseProjectionRun (in this order), then the
-- type ReefClubDoseProjectionRunStatus. Nothing else refers to them yet.

-- CreateEnum
CREATE TYPE "ReefClubDoseProjectionRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ReefClubDoseProjectionRun" (
    "id" TEXT NOT NULL,
    "status" "ReefClubDoseProjectionRunStatus" NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "rowCount" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "ReefClubDoseProjectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReefClubDoseRow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "direction" "DoseEffectDirection" NOT NULL,
    "effectPer100L" DECIMAL(19,6) NOT NULL,
    "doseUnit" "DoseUnit" NOT NULL,
    "doseStep" DECIMAL(19,6) NOT NULL,
    "maxDailyDosePer100L" DECIMAL(19,6),
    "effectHours" INTEGER,
    "source" TEXT NOT NULL,
    "refusals" TEXT[],
    "inStock" BOOLEAN,
    "pricePerDoseUnit" DECIMAL(19,6),

    CONSTRAINT "ReefClubDoseRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReefClubDoseProjectionRun_status_finishedAt_idx" ON "ReefClubDoseProjectionRun"("status", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubDoseRow_sourceId_key" ON "ReefClubDoseRow"("sourceId");

-- CreateIndex
CREATE INDEX "ReefClubDoseRow_runId_idx" ON "ReefClubDoseRow"("runId");

-- CreateIndex
CREATE INDEX "ReefClubDoseRow_productId_idx" ON "ReefClubDoseRow"("productId");

-- CreateIndex
CREATE INDEX "ReefClubDoseRow_parameterCode_direction_idx" ON "ReefClubDoseRow"("parameterCode", "direction");

-- AddForeignKey
ALTER TABLE "ReefClubDoseRow" ADD CONSTRAINT "ReefClubDoseRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReefClubDoseProjectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

