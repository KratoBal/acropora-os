-- ReefClub, slice 8 (task reefclub-szelet-8, plan v6.1 sections 2.2, 6.1 and 6.5): the log of the
-- automatic recommendation and the dose the customer actually gave. Additive only: two new tables
-- and one new enum; no existing table or column changes. Nothing writes to them yet (the
-- recommendation service and its endpoints come in the next PRs).
-- ROLLBACK: drop the tables ReefClubAdministeredDose and ReefClubRecommendation (in this order),
-- then the type ReefClubRecommendationStatus. Nothing else refers to them.

-- CreateEnum
CREATE TYPE "ReefClubRecommendationStatus" AS ENUM ('OPEN', 'GIVEN', 'PARTIAL', 'NOT_GIVEN');

-- CreateTable
CREATE TABLE "ReefClubRecommendation" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "direction" "DoseEffectDirection" NOT NULL,
    "frameVersion" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "basisMeasurementId" TEXT,
    "basisMeasuredAt" TIMESTAMP(3) NOT NULL,
    "doseEffectId" TEXT,
    "doseEffectVersion" INTEGER NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "amount" DECIMAL(19,6) NOT NULL,
    "doseUnit" "DoseUnit" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "effectHours" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "reservedChanges" JSONB NOT NULL,
    "status" "ReefClubRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "effectEndsAt" TIMESTAMP(3) NOT NULL,
    "feedbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReefClubAdministeredDose" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "recommendationId" TEXT,
    "productId" TEXT,
    "amount" DECIMAL(19,6),
    "doseUnit" "DoseUnit",
    "administeredAt" TIMESTAMP(3) NOT NULL,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubAdministeredDose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_aquariumId_parameterCode_createdAt_idx" ON "ReefClubRecommendation"("aquariumId", "parameterCode", "createdAt");

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_aquariumId_status_idx" ON "ReefClubRecommendation"("aquariumId", "status");

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_accountId_idx" ON "ReefClubRecommendation"("accountId");

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_basisMeasurementId_idx" ON "ReefClubRecommendation"("basisMeasurementId");

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_doseEffectId_idx" ON "ReefClubRecommendation"("doseEffectId");

-- CreateIndex
CREATE INDEX "ReefClubRecommendation_productId_idx" ON "ReefClubRecommendation"("productId");

-- CreateIndex
CREATE INDEX "ReefClubAdministeredDose_aquariumId_parameterCode_administe_idx" ON "ReefClubAdministeredDose"("aquariumId", "parameterCode", "administeredAt");

-- CreateIndex
CREATE INDEX "ReefClubAdministeredDose_accountId_idx" ON "ReefClubAdministeredDose"("accountId");

-- CreateIndex
CREATE INDEX "ReefClubAdministeredDose_recommendationId_idx" ON "ReefClubAdministeredDose"("recommendationId");

-- CreateIndex
CREATE INDEX "ReefClubAdministeredDose_productId_idx" ON "ReefClubAdministeredDose"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubAdministeredDose_aquariumId_clientOperationId_key" ON "ReefClubAdministeredDose"("aquariumId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "ReefClubRecommendation" ADD CONSTRAINT "ReefClubRecommendation_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRecommendation" ADD CONSTRAINT "ReefClubRecommendation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRecommendation" ADD CONSTRAINT "ReefClubRecommendation_basisMeasurementId_fkey" FOREIGN KEY ("basisMeasurementId") REFERENCES "AquariumMeasurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRecommendation" ADD CONSTRAINT "ReefClubRecommendation_doseEffectId_fkey" FOREIGN KEY ("doseEffectId") REFERENCES "ProductDoseEffect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRecommendation" ADD CONSTRAINT "ReefClubRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubAdministeredDose" ADD CONSTRAINT "ReefClubAdministeredDose_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubAdministeredDose" ADD CONSTRAINT "ReefClubAdministeredDose_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubAdministeredDose" ADD CONSTRAINT "ReefClubAdministeredDose_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "ReefClubRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubAdministeredDose" ADD CONSTRAINT "ReefClubAdministeredDose_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

