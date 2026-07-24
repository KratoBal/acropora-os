-- AlterTable
ALTER TABLE "Supplier"
    ADD COLUMN "iban" TEXT,
    ADD COLUMN "swiftCode" TEXT,
    ADD COLUMN "bankAccountNumber" TEXT,
    ADD COLUMN "contactPersonName" TEXT,
    ADD COLUMN "contactPersonPhone" TEXT,
    ADD COLUMN "contactPersonEmail" TEXT;
