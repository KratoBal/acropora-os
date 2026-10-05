-- Contract line repair fees (card 3d80a18d, Balázs 2026-10-05): five optional columns, additive only.
-- No backfill: existing lines and maintenance orders are untouched.
-- AlterTable
ALTER TABLE "ContractItem" ADD COLUMN     "repairFeeHoliday" DECIMAL(19,4),
ADD COLUMN     "repairFeeWorkdayHours" DECIMAL(19,4),
ADD COLUMN     "repairFeeWorkdayOffHours" DECIMAL(19,4),
ADD COLUMN     "repairTotal" DECIMAL(19,4),
ADD COLUMN     "repairWeight" DECIMAL(19,4);

