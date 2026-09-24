-- AlterTable
ALTER TABLE "Aquarium" ADD COLUMN     "clientOperationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Aquarium_clientOperationId_key" ON "Aquarium"("clientOperationId");
