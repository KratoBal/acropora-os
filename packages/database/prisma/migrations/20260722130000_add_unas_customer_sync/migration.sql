-- CreateEnum
CREATE TYPE "UnasCustomerSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "UnasCustomerSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "UnasCustomerSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "customersSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnasCustomerSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnasCustomerSyncRun_activeKey_key" ON "UnasCustomerSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "UnasCustomerSyncRun_status_createdAt_idx" ON "UnasCustomerSyncRun"("status", "createdAt");
