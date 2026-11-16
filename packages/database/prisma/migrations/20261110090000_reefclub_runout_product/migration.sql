-- ReefClub V3.2 (card cd94ed11, task reefclub-kifogyas-emlekezteto), slice 4: the run-out reminder's product list for the
-- ReefClub role, which may not read the product tables. Additive only: one new table; no existing table or column changes. The OS
-- process rebuilds it together with the dose list, in the same transaction and run; the ReefClub role only reads.
-- ROLLBACK: drop the table ReefClubRunOutProduct. Nothing else refers to it.

-- CreateTable
CREATE TABLE "ReefClubRunOutProduct" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "packageText" TEXT NOT NULL,
    "packageMl" DECIMAL(19,6) NOT NULL,

    CONSTRAINT "ReefClubRunOutProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubRunOutProduct_productId_key" ON "ReefClubRunOutProduct"("productId");

-- CreateIndex
CREATE INDEX "ReefClubRunOutProduct_runId_idx" ON "ReefClubRunOutProduct"("runId");

-- AddForeignKey
ALTER TABLE "ReefClubRunOutProduct" ADD CONSTRAINT "ReefClubRunOutProduct_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReefClubDoseProjectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
