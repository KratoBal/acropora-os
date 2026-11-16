-- THE RETURN OF A RENTAL (task eszkozberles, S4). Five nullable columns; no existing row is touched (an open rental has none,
-- a rental returned before S4 keeps null: its settlement was never recorded and is not invented now).
-- ROLLBACK: ALTER TABLE "Rental" DROP COLUMN "finalFeeHuf", DROP COLUMN "lateSurchargeHuf",
--           DROP COLUMN "depositKeptHuf", DROP COLUMN "depositKeptReason", DROP COLUMN "returnedById";
-- AlterTable
ALTER TABLE "Rental" ADD COLUMN     "depositKeptHuf" INTEGER,
ADD COLUMN     "depositKeptReason" TEXT,
ADD COLUMN     "finalFeeHuf" INTEGER,
ADD COLUMN     "lateSurchargeHuf" INTEGER,
ADD COLUMN     "returnedById" TEXT;
