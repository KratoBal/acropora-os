-- CreateEnum
CREATE TYPE "UnasOrderSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLIED', 'FAILED');

-- AlterTable
ALTER TABLE "SalesOrder"
    ADD COLUMN "buyerName" TEXT,
    ADD COLUMN "buyerEmail" TEXT;

-- CreateTable
CREATE TABLE "UnasOrderSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "UnasOrderSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ordersSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "reversedCount" INTEGER NOT NULL DEFAULT 0,
    "stockMismatchCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnasOrderSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnasOrderSyncRun_activeKey_key" ON "UnasOrderSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "UnasOrderSyncRun_status_createdAt_idx" ON "UnasOrderSyncRun"("status", "createdAt");
