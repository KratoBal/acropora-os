-- ReefClub, slice 2 (task reefclub-szelet-2, plan v6.1 sections 2.2 and 3.2): the customer
-- app's own account, its session and its single-use e-mail tokens. Additive only: three new
-- tables and one new enum, no existing row or column changes. The account is deliberately
-- not a row of "User": the internal guards never read these tables.
-- ROLLBACK: drop the three tables (ReefClubAccountToken and ReefClubSession first, they
-- reference ReefClubAccount) and the ReefClubTokenPurpose type. Nothing else refers to them.
-- CreateEnum
CREATE TYPE "ReefClubTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "ReefClubAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "notifyOnRelease" BOOLEAN NOT NULL DEFAULT true,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReefClubAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReefClubSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReefClubAccountToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" "ReefClubTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubAccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubAccount_email_key" ON "ReefClubAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubSession_tokenHash_key" ON "ReefClubSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ReefClubSession_accountId_idx" ON "ReefClubSession"("accountId");

-- CreateIndex
CREATE INDEX "ReefClubSession_expiresAt_idx" ON "ReefClubSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubAccountToken_tokenHash_key" ON "ReefClubAccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ReefClubAccountToken_accountId_purpose_idx" ON "ReefClubAccountToken"("accountId", "purpose");

-- AddForeignKey
ALTER TABLE "ReefClubSession" ADD CONSTRAINT "ReefClubSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReefClubAccountToken" ADD CONSTRAINT "ReefClubAccountToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

