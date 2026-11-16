-- RENTAL SETTINGS (task eszkozberles, S3). One new, empty table, and three nullable columns on "Rental" that freeze the
-- contract's text and late-return settings at recording time; no existing row is changed (an earlier rental keeps null).
-- ROLLBACK: DROP TABLE "RentalSetting";
--           ALTER TABLE "Rental" DROP COLUMN "contractTemplate", DROP COLUMN "lateFeeMultiplier", DROP COLUMN "replacementAfterDays";
-- CreateTable
CREATE TABLE "RentalSetting" (
    "id" TEXT NOT NULL,
    "contractTemplate" TEXT,
    "lateFeeMultiplier" DECIMAL(5,2),
    "replacementAfterDays" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalSetting_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Rental" ADD COLUMN     "contractTemplate" TEXT,
ADD COLUMN     "lateFeeMultiplier" DECIMAL(5,2),
ADD COLUMN     "replacementAfterDays" INTEGER;
