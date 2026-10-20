-- ReefClub, slice 7 (barracuda's #1731 review, points a and c): who archived a dose row, and the
-- recorder's name kept on each version. Additive only: two nullable columns, a foreign key, an index.
-- ROLLBACK: drop the foreign key and the index on "archivedById", then the columns "archivedById"
-- and "recordedByName". The rows stay; only who archived a row and the kept names are lost.
-- AlterTable
ALTER TABLE "ProductDoseEffect" ADD COLUMN     "archivedById" TEXT;

-- AlterTable
ALTER TABLE "ProductDoseEffectVersion" ADD COLUMN     "recordedByName" TEXT;

-- CreateIndex
CREATE INDEX "ProductDoseEffect_archivedById_idx" ON "ProductDoseEffect"("archivedById");

-- AddForeignKey
ALTER TABLE "ProductDoseEffect" ADD CONSTRAINT "ProductDoseEffect_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

