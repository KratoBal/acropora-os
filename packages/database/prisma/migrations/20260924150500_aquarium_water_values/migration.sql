-- AlterTable
ALTER TABLE "AquariumMeasurement" ADD COLUMN     "clientOperationId" TEXT;

-- CreateTable
CREATE TABLE "AquariumMaintainer" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AquariumMaintainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AquariumMaintainer_userId_idx" ON "AquariumMaintainer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AquariumMaintainer_aquariumId_userId_key" ON "AquariumMaintainer"("aquariumId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AquariumMeasurement_aquariumId_clientOperationId_parameterC_key" ON "AquariumMeasurement"("aquariumId", "clientOperationId", "parameterCode");

-- AddForeignKey
ALTER TABLE "AquariumMaintainer" ADD CONSTRAINT "AquariumMaintainer_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMaintainer" ADD CONSTRAINT "AquariumMaintainer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
