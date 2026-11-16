-- ReefClub V3.2 (card cd94ed11, task reefclub-kifogyas-emlekezteto), slice 2: the per-product consent of the "when does it run
-- out" reminder. Additive only: one new table; no existing table or column changes. The table starts EMPTY and nothing writes to
-- it until the switch REEFCLUB_RUNOUT_ENABLED is on AND the consent text is given (both off today).
-- ROLLBACK: drop the table ReefClubRunOutReminder. Nothing else refers to it.

-- CreateTable
CREATE TABLE "ReefClubRunOutReminder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReefClubRunOutReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubRunOutReminder_unsubscribeToken_key" ON "ReefClubRunOutReminder"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubRunOutReminder_accountId_productId_key" ON "ReefClubRunOutReminder"("accountId", "productId");

-- CreateIndex
CREATE INDEX "ReefClubRunOutReminder_productId_idx" ON "ReefClubRunOutReminder"("productId");

-- CreateIndex
CREATE INDEX "ReefClubRunOutReminder_aquariumId_idx" ON "ReefClubRunOutReminder"("aquariumId");

-- AddForeignKey
ALTER TABLE "ReefClubRunOutReminder" ADD CONSTRAINT "ReefClubRunOutReminder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRunOutReminder" ADD CONSTRAINT "ReefClubRunOutReminder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubRunOutReminder" ADD CONSTRAINT "ReefClubRunOutReminder_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;
