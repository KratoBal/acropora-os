-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "continuesWorksheetId" TEXT;

-- CreateIndex
CREATE INDEX "Worksheet_continuesWorksheetId_idx" ON "Worksheet"("continuesWorksheetId");

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_continuesWorksheetId_fkey" FOREIGN KEY ("continuesWorksheetId") REFERENCES "Worksheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

