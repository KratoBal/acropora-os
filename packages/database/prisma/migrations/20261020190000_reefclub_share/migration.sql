-- ReefClub, slice 5a (task reefclub-szelet-5a, plan v6.1 section 4.4): sharing a ReefClub aquarium
-- with the shop, and the log of the share, the revoke and every internal read of a shared one.
-- Additive only: two nullable columns on Aquarium, one new table, one new enum, one CHECK that every
-- existing row satisfies (the new columns are empty on all of them).
-- ROLLBACK: drop the CHECK "Aquarium_share_owner_check", the table AquariumShareEvent, the type
-- AquariumShareEventKind and the two columns. The ReefClub aquariums are then private again (the
-- internal side reads only rows without an owner account), which is the safe direction.
-- CreateEnum
CREATE TYPE "AquariumShareEventKind" AS ENUM ('SHARED', 'REVOKED', 'INTERNAL_READ');

-- AlterTable
ALTER TABLE "Aquarium" ADD COLUMN     "shareConsentVersion" TEXT,
ADD COLUMN     "sharedWithShopAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AquariumShareEvent" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "kind" "AquariumShareEventKind" NOT NULL,
    "accountId" TEXT,
    "userId" TEXT,
    "consentVersion" TEXT,
    "purpose" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AquariumShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AquariumShareEvent_aquariumId_createdAt_idx" ON "AquariumShareEvent"("aquariumId", "createdAt");

-- CreateIndex
CREATE INDEX "AquariumShareEvent_accountId_idx" ON "AquariumShareEvent"("accountId");

-- CreateIndex
CREATE INDEX "AquariumShareEvent_userId_idx" ON "AquariumShareEvent"("userId");

-- AddForeignKey
ALTER TABLE "AquariumShareEvent" ADD CONSTRAINT "AquariumShareEvent_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumShareEvent" ADD CONSTRAINT "AquariumShareEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumShareEvent" ADD CONSTRAINT "AquariumShareEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only a ReefClub aquarium (an owner account) can be shared: a shop aquarium has no share state.
ALTER TABLE "Aquarium" ADD CONSTRAINT "Aquarium_share_owner_check" CHECK (
  "sharedWithShopAt" IS NULL OR "ownerAccountId" IS NOT NULL
);
