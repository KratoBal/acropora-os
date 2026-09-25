-- CreateIndex
CREATE UNIQUE INDEX "AquariumMeasurement_aquariumId_measuredAt_parameterCode_key" ON "AquariumMeasurement"("aquariumId", "measuredAt", "parameterCode");
