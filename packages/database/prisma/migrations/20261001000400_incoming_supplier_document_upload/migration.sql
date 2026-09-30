-- Hiányzó számlák, 4b: a drawerből feltöltött számla a postafiókkal közös
-- forrásba kerül, a származásával. A régi sorok MAILBOX alapértéket kapnak.

-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'MAILBOX',
ADD COLUMN     "uploadKind" TEXT,
ADD COLUMN     "uploadedByUserId" TEXT;
