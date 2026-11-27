-- Több alternatíva egy tételre (Luca 2026-11-27, card 2540d9d4): egy tételt több opcionális tétel is kiválthat. Additive loosening: the unique index on
-- ("replacesItemId", "versionId") goes, a plain index of the same columns stays for the lookups. No row changes: every existing row keeps its
-- value, and the foreign key (it points at the unique ("id", "versionId")) and the CHECK are untouched. That the options of one item exclude each other
-- is the application's rule (the acceptance rejects two chosen), not the database's.

-- DropIndex
DROP INDEX "QuoteItem_replacesItemId_versionId_key";

-- CreateIndex
CREATE INDEX "QuoteItem_replacesItemId_versionId_idx" ON "QuoteItem"("replacesItemId", "versionId");
