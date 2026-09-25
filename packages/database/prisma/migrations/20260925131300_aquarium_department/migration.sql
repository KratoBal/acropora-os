-- AlterTable
ALTER TABLE "Aquarium" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "Aquarium_departmentId_idx" ON "Aquarium"("departmentId");

-- AddForeignKey
ALTER TABLE "Aquarium" ADD CONSTRAINT "Aquarium_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
