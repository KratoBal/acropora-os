-- Számla-begyűjtés (kártya 3e75c2f4): a látott fájlok és a futások, és az
-- általános olvasó eredménye a dokumentumon. A látott fájl tartalmat nem tárol.

-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "textReading" JSONB;

-- CreateTable
CREATE TABLE "InvoiceCollectionItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT,
    "verdict" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCollectionRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "SupplierInvoiceMailSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "SyncRunTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "filesSeen" INTEGER NOT NULL DEFAULT 0,
    "storedCount" INTEGER NOT NULL DEFAULT 0,
    "notInvoiceCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceCollectionItem_sha256_idx" ON "InvoiceCollectionItem"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCollectionItem_source_externalId_fileName_key" ON "InvoiceCollectionItem"("source", "externalId", "fileName");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCollectionRun_activeKey_key" ON "InvoiceCollectionRun"("activeKey");

-- CreateIndex
CREATE INDEX "InvoiceCollectionRun_startedAt_idx" ON "InvoiceCollectionRun"("startedAt");

