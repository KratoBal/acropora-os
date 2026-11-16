-- T5.3, slice 2 (task t53-gyartoi-allitasok): a content item names the manufacturer claims it stands
-- on. Additive only: one new table; no existing table or column changes.
-- ROLLBACK: drop the table ContentItemClaim. The content state machine reads it only at approval
-- and when a claim drops out; without it, approval goes as before.
-- CreateTable
CREATE TABLE "ContentItemClaim" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItemClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentItemClaim_claimId_idx" ON "ContentItemClaim"("claimId");

-- CreateIndex
CREATE INDEX "ContentItemClaim_linkedById_idx" ON "ContentItemClaim"("linkedById");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItemClaim_contentId_claimId_key" ON "ContentItemClaim"("contentId", "claimId");

-- AddForeignKey
ALTER TABLE "ContentItemClaim" ADD CONSTRAINT "ContentItemClaim_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemClaim" ADD CONSTRAINT "ContentItemClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProductManufacturerClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItemClaim" ADD CONSTRAINT "ContentItemClaim_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

