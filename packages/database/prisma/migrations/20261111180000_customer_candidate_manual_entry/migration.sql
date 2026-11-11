-- V3.4 S2c (card ce6c5cc9): the hand-picked list of the products that may be named to a customer, filled by the
-- `customer-candidates:import` command. Additive only: two new types and one new table; no existing table or column changes. Empty
-- at the start: nothing reaches a customer from it until a row is imported, its side effects are FILLED and the projection (S2b)
-- takes it. ROLLBACK: drop the table CustomerCandidateManualEntry, then the two types.

-- CreateEnum
CREATE TYPE "CustomerCandidateBasis" AS ENUM ('MAKER', 'SHOP_TEXT');

-- CreateEnum
CREATE TYPE "CustomerCandidateSideEffectsStatus" AS ENUM ('FILLED', 'PENDING');

-- CreateTable
CREATE TABLE "CustomerCandidateManualEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "direction" "DoseEffectDirection" NOT NULL,
    "referenceUrl" TEXT NOT NULL,
    "basis" "CustomerCandidateBasis" NOT NULL,
    "sideEffects" TEXT[],
    "sideEffectsStatus" "CustomerCandidateSideEffectsStatus" NOT NULL,
    "note" TEXT,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCandidateManualEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerCandidateManualEntry_reference_https" CHECK ("referenceUrl" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "CustomerCandidateManualEntry_parameter_approved" CHECK ("parameterCode" IN ('KH', 'KALCIUM', 'MAGNEZIUM', 'NITRAT')),
    CONSTRAINT "CustomerCandidateManualEntry_approver_named" CHECK (length(btrim("approvedBy")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCandidateManualEntry_productId_parameterCode_direction_key" ON "CustomerCandidateManualEntry"("productId", "parameterCode", "direction");

-- CreateIndex
CREATE INDEX "CustomerCandidateManualEntry_parameterCode_direction_idx" ON "CustomerCandidateManualEntry"("parameterCode", "direction");

-- AddForeignKey
ALTER TABLE "CustomerCandidateManualEntry" ADD CONSTRAINT "CustomerCandidateManualEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
