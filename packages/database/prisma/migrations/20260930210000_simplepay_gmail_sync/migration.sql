-- A SimplePay heti kimutatásának Gmail-behúzása: a feldolgozott levelek
-- naplója és a futások. Csak új felsorolás és két új tábla; meglévő táblát
-- és sort nem érint.

-- CreateEnum
CREATE TYPE "SimplePaySyncRunStatus" AS ENUM ('RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "SimplePayGmailMessage" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "subject" TEXT,
    "documentCount" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimplePayGmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimplePaySyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "SimplePaySyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "SyncRunTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "documentsRead" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimplePaySyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimplePayGmailMessage_gmailMessageId_key" ON "SimplePayGmailMessage"("gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SimplePaySyncRun_activeKey_key" ON "SimplePaySyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "SimplePaySyncRun_startedAt_idx" ON "SimplePaySyncRun"("startedAt");
