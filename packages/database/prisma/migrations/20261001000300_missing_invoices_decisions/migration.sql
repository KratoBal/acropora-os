-- Hiányzó számlák, 4. szelet: a kezelő döntései. Új oszlopok a terhelésen
-- (megjegyzés, kézi átsorolás, papíron megvan), és a kézi párosítás táblája.
-- Meglévő sort nem ír át.

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "categoryOverride" TEXT,
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "paperOriginalAt" TIMESTAMP(3),
ADD COLUMN     "paperOriginalByUserId" TEXT;

-- CreateTable
CREATE TABLE "BankTransactionMatch" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "documentSource" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pairedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransactionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransactionMatch_bankTransactionId_idx" ON "BankTransactionMatch"("bankTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransactionMatch_documentSource_documentId_key" ON "BankTransactionMatch"("documentSource", "documentId");

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

