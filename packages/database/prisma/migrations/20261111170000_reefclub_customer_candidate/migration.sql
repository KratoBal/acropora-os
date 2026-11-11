-- ReefClub V3.4 S2b (card ce6c5cc9): the products the ReefClub may name to a customer for a measured deviation, for the ReefClub
-- role, which may not read the product tables. Additive only: one new table; no existing table or column changes. The OS process
-- rebuilds it together with the dose list, in the same transaction and run; the ReefClub role only reads. An empty table means "no
-- recommendation", which is the starting state (today 0 of 100 products have a VERIFIED effect).
-- ROLLBACK: drop the table ReefClubCustomerCandidate. Nothing else refers to it.

-- CreateTable
CREATE TABLE "ReefClubCustomerCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "direction" "DoseEffectDirection" NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shopUrl" TEXT,
    "evidenceRef" TEXT NOT NULL,
    "effects" TEXT[],
    "rank" INTEGER NOT NULL,

    CONSTRAINT "ReefClubCustomerCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReefClubCustomerCandidate_evidence_https" CHECK ("evidenceRef" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "ReefClubCustomerCandidate_parameter_approved" CHECK ("parameterCode" IN ('KH', 'KALCIUM', 'MAGNEZIUM', 'NITRAT'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubCustomerCandidate_parameterCode_direction_productId_key" ON "ReefClubCustomerCandidate"("parameterCode", "direction", "productId");

-- CreateIndex
CREATE INDEX "ReefClubCustomerCandidate_runId_idx" ON "ReefClubCustomerCandidate"("runId");

-- CreateIndex
CREATE INDEX "ReefClubCustomerCandidate_parameterCode_direction_rank_idx" ON "ReefClubCustomerCandidate"("parameterCode", "direction", "rank");

-- AddForeignKey
ALTER TABLE "ReefClubCustomerCandidate" ADD CONSTRAINT "ReefClubCustomerCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReefClubDoseProjectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
