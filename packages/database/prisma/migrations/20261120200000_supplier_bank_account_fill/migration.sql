-- A szállító bankszámlaszáma, amit a számla PDF-jéből vagy korábbi terheléséből töltöttünk ki (acrobot 58553, kártya 4900497b).
-- Szállítónként egy sor, soha nem ír felül meglévő számlaszámot; a számla sora a feedből származtatott és felülíródik, ezért külön tábla.


-- CreateEnum
CREATE TYPE "SupplierBankAccountSource" AS ENUM ('INVOICE_PDF', 'PAIRED_DEBIT');

-- CreateTable
CREATE TABLE "SupplierBankAccountFill" (
    "id" TEXT NOT NULL,
    "supplierKey" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierTaxNumber" TEXT,
    "supplierEuTaxNumber" TEXT,
    "account" TEXT NOT NULL,
    "source" "SupplierBankAccountSource" NOT NULL,
    "evidenceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBankAccountFill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBankAccountFill_supplierKey_key" ON "SupplierBankAccountFill"("supplierKey");

