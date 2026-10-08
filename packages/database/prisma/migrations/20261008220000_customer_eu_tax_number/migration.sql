-- The customer's community (EU) tax number, apart from the Hungarian one
-- (acrobot 28145): the Számlázz.hu Agent takes it in <adoszamEU>, and an EU
-- number in <adoszam> would be refused or reported wrong to NAV. A nullable
-- column: no existing row is affected.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "euTaxNumber" TEXT;

