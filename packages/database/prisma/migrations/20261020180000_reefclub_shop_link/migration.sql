-- ReefClub, slice 5 (task reefclub-szelet-5, plan v6.1 sections 2.2, 3.3 and 3.5): the shop link
-- of a ReefClub account with a private-person customer, the single-use code it is made with, and
-- the release of a shop measurement occasion. Additive only: three new tables and two new enums;
-- no existing table or column changes.
-- ROLLBACK: drop the tables AquariumMeasurementRelease, ReefClubCustomerLink and ReefClubLinkCode
-- (in this order), then the types ReefClubLinkEndedBy and ReefClubLinkStatus. Nothing else refers
-- to them. The ReefClub then sees only the account's own aquariums again (the shop branch of the
-- access function finds no link), and the OS loses only the release marks.
-- CreateEnum
CREATE TYPE "ReefClubLinkStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ReefClubLinkEndedBy" AS ENUM ('ACCOUNT', 'SHOP');

-- CreateTable
CREATE TABLE "ReefClubLinkCode" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByAccountId" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReefClubCustomerLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ReefClubLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "codeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" "ReefClubLinkEndedBy",
    "endedByUserId" TEXT,
    "customerNoticeAt" TIMESTAMP(3),
    "customerNoticeAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReefClubCustomerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AquariumMeasurementRelease" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,

    CONSTRAINT "AquariumMeasurementRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubLinkCode_codeHash_key" ON "ReefClubLinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "ReefClubLinkCode_customerId_idx" ON "ReefClubLinkCode"("customerId");

-- CreateIndex
CREATE INDEX "ReefClubLinkCode_usedByAccountId_idx" ON "ReefClubLinkCode"("usedByAccountId");

-- CreateIndex
CREATE INDEX "ReefClubLinkCode_issuedById_idx" ON "ReefClubLinkCode"("issuedById");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubCustomerLink_codeId_key" ON "ReefClubCustomerLink"("codeId");

-- CreateIndex
CREATE INDEX "ReefClubCustomerLink_accountId_status_idx" ON "ReefClubCustomerLink"("accountId", "status");

-- CreateIndex
CREATE INDEX "ReefClubCustomerLink_customerId_status_idx" ON "ReefClubCustomerLink"("customerId", "status");

-- CreateIndex
CREATE INDEX "ReefClubCustomerLink_endedByUserId_idx" ON "ReefClubCustomerLink"("endedByUserId");

-- CreateIndex
CREATE INDEX "AquariumMeasurementRelease_releasedById_idx" ON "AquariumMeasurementRelease"("releasedById");

-- CreateIndex
CREATE UNIQUE INDEX "AquariumMeasurementRelease_aquariumId_measuredAt_key" ON "AquariumMeasurementRelease"("aquariumId", "measuredAt");

-- AddForeignKey
ALTER TABLE "ReefClubLinkCode" ADD CONSTRAINT "ReefClubLinkCode_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubLinkCode" ADD CONSTRAINT "ReefClubLinkCode_usedByAccountId_fkey" FOREIGN KEY ("usedByAccountId") REFERENCES "ReefClubAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubLinkCode" ADD CONSTRAINT "ReefClubLinkCode_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubCustomerLink" ADD CONSTRAINT "ReefClubCustomerLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubCustomerLink" ADD CONSTRAINT "ReefClubCustomerLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubCustomerLink" ADD CONSTRAINT "ReefClubCustomerLink_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ReefClubLinkCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubCustomerLink" ADD CONSTRAINT "ReefClubCustomerLink_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurementRelease" ADD CONSTRAINT "AquariumMeasurementRelease_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurementRelease" ADD CONSTRAINT "AquariumMeasurementRelease_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One ACTIVE link between an account and a customer at most (plan 4.2: the access function asks
-- "is there an active link", and two active rows would make an ended one look still active). An
-- ended link stays as the record, so the constraint covers only the active rows.
CREATE UNIQUE INDEX "ReefClubCustomerLink_active_key" ON "ReefClubCustomerLink"("accountId", "customerId") WHERE "status" = 'ACTIVE';
