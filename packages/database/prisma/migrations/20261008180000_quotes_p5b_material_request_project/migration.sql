-- #1582 P5b: a material request for a worksheet or for a project (the quote
-- handoff's shortage), and an item that names its OS product and BOM item.

-- Every request today belongs to a worksheet. Checked first, so a row that
-- does not stops this with a sentence instead of a constraint error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MaterialRequest" WHERE "worksheetId" IS NULL) THEN
    RAISE EXCEPTION 'P5b: a MaterialRequest row without a worksheet';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "MaterialRequest" ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "worksheetId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MaterialRequestItem" ADD COLUMN     "quoteBomItemId" TEXT,
ADD COLUMN     "variantId" TEXT;

-- CreateIndex
CREATE INDEX "MaterialRequest_projectId_createdAt_idx" ON "MaterialRequest"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequestItem_quoteBomItemId_key" ON "MaterialRequestItem"("quoteBomItemId");

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_quoteBomItemId_fkey" FOREIGN KEY ("quoteBomItemId") REFERENCES "QuoteBomItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- exactly one parent: a worksheet or a project
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_one_parent_check" CHECK (num_nonnulls("worksheetId", "projectId") = 1);
