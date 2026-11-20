-- A kézi megadás: új forrás-érték és a ki/mikor mezők a szállítói számlaszám kitöltéshez (acrobot 58655, kártya 4900497b).


-- AlterEnum
ALTER TYPE "SupplierBankAccountSource" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "SupplierBankAccountFill" ADD COLUMN     "enteredAt" TIMESTAMP(3),
ADD COLUMN     "enteredByUserId" TEXT;

