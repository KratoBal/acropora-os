-- AlterTable
ALTER TABLE "ProductDatasheet" ADD COLUMN     "acclimatization" TEXT,
ADD COLUMN     "breedsInTank" BOOLEAN,
ADD COLUMN     "handlingWarning" TEXT,
ADD COLUMN     "khMaxDkh" DECIMAL(4,1),
ADD COLUMN     "khMinDkh" DECIMAL(4,1),
ADD COLUMN     "lifespanYears" INTEGER,
ADD COLUMN     "quarantineWeeks" INTEGER,
ADD COLUMN     "salinityMaxSg" DECIMAL(5,3),
ADD COLUMN     "salinityMinSg" DECIMAL(5,3),
ADD COLUMN     "stingOrVenom" BOOLEAN,
ADD COLUMN     "tempMaxC" DECIMAL(4,1),
ADD COLUMN     "tempMinC" DECIMAL(4,1);

