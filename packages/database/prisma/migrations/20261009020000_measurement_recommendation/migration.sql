-- CreateEnum
CREATE TYPE "MeasurementRecommendationStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "AquariumMeasurementRecommendation" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "status" "MeasurementRecommendationStatus" NOT NULL DEFAULT 'DRAFT',
    "input" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "aiDraft" TEXT,
    "aiModel" TEXT,
    "aiRequestedAt" TIMESTAMP(3),
    "draftText" TEXT,
    "approvedText" TEXT,
    "productIds" TEXT[],
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AquariumMeasurementRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AquariumMeasurementRecommendation_status_approvedAt_idx" ON "AquariumMeasurementRecommendation"("status", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AquariumMeasurementRecommendation_aquariumId_measuredAt_key" ON "AquariumMeasurementRecommendation"("aquariumId", "measuredAt");

-- AddForeignKey
ALTER TABLE "AquariumMeasurementRecommendation" ADD CONSTRAINT "AquariumMeasurementRecommendation_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurementRecommendation" ADD CONSTRAINT "AquariumMeasurementRecommendation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurementRecommendation" ADD CONSTRAINT "AquariumMeasurementRecommendation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

