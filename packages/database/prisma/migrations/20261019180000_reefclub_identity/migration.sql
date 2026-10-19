-- ReefClub, slice 3 (task reefclub-szelet-3, plan v6.1 sections 2.2 and 3.2): the Google and
-- Apple sign-in of a ReefClub account. Additive only: one new table and one new enum, no
-- existing row or column changes.
-- ROLLBACK: drop the ReefClubIdentity table, then the ReefClubIdentityProvider type. Nothing
-- else refers to them; the accounts stay, and an account created by an external sign-in keeps
-- its verified e-mail without a password (it can then sign in through a password reset).
-- CreateEnum
CREATE TYPE "ReefClubIdentityProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateTable
CREATE TABLE "ReefClubIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "ReefClubIdentityProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReefClubIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubIdentity_accountId_provider_key" ON "ReefClubIdentity"("accountId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ReefClubIdentity_provider_subject_key" ON "ReefClubIdentity"("provider", "subject");

-- AddForeignKey
ALTER TABLE "ReefClubIdentity" ADD CONSTRAINT "ReefClubIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
