-- Kiváltott tétel (Luca 2026-11-26, card 2540d9d4), PR 1: egy opcionális tétel a (nem opcionális) tétel HELYÉRE léphet. Additive: one nullable column
-- (null on every existing row, so every existing acceptance keeps the old rule: the optional item is added), its index and its foreign key.

-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN     "replacesItemId" TEXT;

-- CreateIndex: an item is replaced by at most one optional item
CREATE UNIQUE INDEX "QuoteItem_replacesItemId_versionId_key" ON "QuoteItem"("replacesItemId", "versionId");

-- AddForeignKey: the composite key keeps the replaced item in the SAME version
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_replacesItemId_versionId_fkey" FOREIGN KEY ("replacesItemId", "versionId") REFERENCES "QuoteItem"("id", "versionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only an optional item replaces, and never itself. (Prisma cannot express a CHECK; the schema comment names it.)
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_replaces_only_optional" CHECK ("replacesItemId" IS NULL OR ("isOptional" AND "replacesItemId" <> "id"));
