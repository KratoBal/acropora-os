-- Egy banki tranzakció több forrásból (acrobot 25599): a havi CSV-kivonat és a
-- Számlázz.hu tranzakció-továbbítása. Minden forrás a saját kulcsával foglal le
-- egy tranzakciót. A meglévő sorok a CSV-ből jöttek: a kulcsuk a mai
-- "transactionKey", tehát egy újrafeltöltés ugyanúgy semmit nem ír, mint eddig.

-- CreateEnum
CREATE TYPE "BankTransactionSource" AS ENUM ('CSV', 'SZAMLAZZ');

-- CreateTable
CREATE TABLE "BankTransactionSourceKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "BankTransactionSource" NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransactionSourceKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransactionSourceKey_key_key" ON "BankTransactionSourceKey"("key");

-- CreateIndex
CREATE INDEX "BankTransactionSourceKey_bankTransactionId_idx" ON "BankTransactionSourceKey"("bankTransactionId");

-- AddForeignKey
ALTER TABLE "BankTransactionSourceKey" ADD CONSTRAINT "BankTransactionSourceKey_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: minden meglévő sor a CSV-ből jött, a kulcsa a "transactionKey".
INSERT INTO "BankTransactionSourceKey" ("id", "key", "source", "bankTransactionId")
SELECT 'bsk_' || md5("transactionKey"), "transactionKey", 'CSV', "id"
FROM "BankTransaction";
