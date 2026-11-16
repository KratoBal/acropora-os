-- AlterTable
ALTER TABLE "OperationsLogEntry" ADD COLUMN     "serviceJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OperationsLogEntry_serviceJobId_key" ON "OperationsLogEntry"("serviceJobId");

-- AddForeignKey
ALTER TABLE "OperationsLogEntry" ADD CONSTRAINT "OperationsLogEntry_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

