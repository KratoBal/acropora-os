-- CreateEnum
CREATE TYPE "GlsSyncRunStatus" AS ENUM ('RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "GlsGmailMessage" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "subject" TEXT,
    "documentCount" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlsGmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlsSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "GlsSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "documentsRead" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlsGmailMessage_gmailMessageId_key" ON "GlsGmailMessage"("gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "GlsSyncRun_activeKey_key" ON "GlsSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "GlsSyncRun_startedAt_idx" ON "GlsSyncRun"("startedAt");

