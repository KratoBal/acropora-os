-- The editor's comparison of a figure reading with the image (research-diagram-irany):
-- who accepted a read-off evidence row against the figure, and when. Nullable: no existing
-- row was compared, and a text-verified row never needs it.
-- ROLLBACK: ALTER TABLE "KnowledgeClaimEvidence" DROP CONSTRAINT "KnowledgeClaimEvidence_imageComparedById_fkey", DROP COLUMN "imageComparedAt", DROP COLUMN "imageComparedById";
ALTER TABLE "KnowledgeClaimEvidence" ADD COLUMN     "imageComparedAt" TIMESTAMP(3),
ADD COLUMN     "imageComparedById" TEXT;

ALTER TABLE "KnowledgeClaimEvidence" ADD CONSTRAINT "KnowledgeClaimEvidence_imageComparedById_fkey" FOREIGN KEY ("imageComparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
