-- A TÖRÖLT HIBAJEGYEK SZÁMAI (t-20261118-hibajegy-torles): additív tábla, a sorszám a törlés után sem használódik újra.

-- CreateTable
CREATE TABLE "ServiceJobDeletion" (
    "id" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,

    CONSTRAINT "ServiceJobDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJobDeletion_jobNumber_key" ON "ServiceJobDeletion"("jobNumber");

