-- Az OTP eBIZ számlák napi, csak olvasó szinkronja (2026-10-02). Csak új oszlopok és új tábla.
-- AlterTable
ALTER TABLE "ExternalBillingDocument" ADD COLUMN     "externalPaymentStatus" TEXT,
ADD COLUMN     "pdfMissingReason" TEXT,
ADD COLUMN     "pdfStorageKey" TEXT;

-- CreateEnum
CREATE TYPE "EbizSyncRunStatus" AS ENUM ('RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "EbizSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "EbizSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "SyncRunTrigger",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "pdfStoredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbizSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbizSyncRun_activeKey_key" ON "EbizSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "EbizSyncRun_startedAt_idx" ON "EbizSyncRun"("startedAt");
