-- CreateTable
CREATE TABLE "AquariumMeasurementTarget" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "min" DECIMAL(19,6),
    "max" DECIMAL(19,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AquariumMeasurementTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AquariumMeasurementTarget_aquariumId_parameterCode_key" ON "AquariumMeasurementTarget"("aquariumId", "parameterCode");

-- AddForeignKey
ALTER TABLE "AquariumMeasurementTarget" ADD CONSTRAINT "AquariumMeasurementTarget_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;
