-- RENTAL SETTINGS (task eszkozberles, S3). One new, empty table; no existing row is touched.
-- ROLLBACK: DROP TABLE "RentalSetting";
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

