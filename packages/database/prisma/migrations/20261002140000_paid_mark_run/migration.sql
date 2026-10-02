-- A kifizetett-jelölés automatikus futásának összesítője (acrobot 26101). Csak új tábla.
-- CreateTable
CREATE TABLE "PaidMarkRun" (
    "id" TEXT NOT NULL,
    "source" "OutgoingPaymentMarkSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "writtenCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "attentionCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "attention" JSONB NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "PaidMarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaidMarkRun_source_startedAt_idx" ON "PaidMarkRun"("source", "startedAt");

