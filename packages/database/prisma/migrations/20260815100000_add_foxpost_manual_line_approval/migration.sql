-- AddEnumValue
ALTER TYPE "FoxpostResolutionSource" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "FoxpostSettlementLine"
ADD COLUMN "manualApprovedByUserId" TEXT,
ADD COLUMN "manualApprovedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FoxpostSettlementLine_manualApprovedByUserId_manualApprovedAt_idx"
ON "FoxpostSettlementLine"("manualApprovedByUserId", "manualApprovedAt");

-- AddForeignKey
ALTER TABLE "FoxpostSettlementLine"
ADD CONSTRAINT "FoxpostSettlementLine_manualApprovedByUserId_fkey"
FOREIGN KEY ("manualApprovedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
