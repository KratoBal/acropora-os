-- CreateEnum
CREATE TYPE "CashRegisterReceiptKind" AS ENUM ('SALE', 'STORNO', 'RETURN');

-- CreateEnum
CREATE TYPE "CashRegisterSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "CashRegister" (
    "apNumber" TEXT NOT NULL,
    "lastFileNumber" INTEGER,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("apNumber")
);

-- CreateTable
CREATE TABLE "CashRegisterFile" (
    "id" TEXT NOT NULL,
    "apNumber" TEXT NOT NULL,
    "fileNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "validationCode" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadGzip" BYTEA NOT NULL,
    "payloadSha256" VARCHAR(64) NOT NULL,

    CONSTRAINT "CashRegisterFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterReceipt" (
    "id" TEXT NOT NULL,
    "apNumber" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "businessDay" DATE NOT NULL,
    "total" DECIMAL(20,4) NOT NULL,
    "paymentMeans" TEXT NOT NULL,
    "payments" JSONB NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "kind" "CashRegisterReceiptKind" NOT NULL,
    "navCheckCode" TEXT,

    CONSTRAINT "CashRegisterReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "sum" DECIMAL(20,4) NOT NULL,
    "vatCode" TEXT NOT NULL,

    CONSTRAINT "CashRegisterReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterGap" (
    "id" TEXT NOT NULL,
    "apNumber" TEXT NOT NULL,
    "fromFileNumber" INTEGER NOT NULL,
    "toFileNumber" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "CashRegisterGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "CashRegisterSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "trigger" TEXT NOT NULL,
    "filesFetched" INTEGER NOT NULL DEFAULT 0,
    "receiptsCreated" INTEGER NOT NULL DEFAULT 0,
    "gapsRecorded" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRegisterSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterFile_apNumber_fileNumber_key" ON "CashRegisterFile"("apNumber", "fileNumber");

-- CreateIndex
CREATE INDEX "CashRegisterReceipt_businessDay_issuedAt_id_idx" ON "CashRegisterReceipt"("businessDay", "issuedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterReceipt_apNumber_receiptNumber_fileId_key" ON "CashRegisterReceipt"("apNumber", "receiptNumber", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterReceiptLine_receiptId_position_key" ON "CashRegisterReceiptLine"("receiptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterGap_apNumber_fromFileNumber_toFileNumber_key" ON "CashRegisterGap"("apNumber", "fromFileNumber", "toFileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterSyncRun_activeKey_key" ON "CashRegisterSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "CashRegisterSyncRun_startedAt_idx" ON "CashRegisterSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "CashRegisterFile" ADD CONSTRAINT "CashRegisterFile_apNumber_fkey" FOREIGN KEY ("apNumber") REFERENCES "CashRegister"("apNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterReceipt" ADD CONSTRAINT "CashRegisterReceipt_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CashRegisterFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterReceiptLine" ADD CONSTRAINT "CashRegisterReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "CashRegisterReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterGap" ADD CONSTRAINT "CashRegisterGap_apNumber_fkey" FOREIGN KEY ("apNumber") REFERENCES "CashRegister"("apNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

