-- #1582 P3: sending a published version by email. One row per attempt, and a
-- conditional claim on the version so two clicks send one mail.
-- AlterTable
ALTER TABLE "QuoteVersion" ADD COLUMN     "sendingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuoteMailDelivery" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "requestId" TEXT,
    "isResend" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteMailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteMailDelivery_requestId_key" ON "QuoteMailDelivery"("requestId");

-- CreateIndex
CREATE INDEX "QuoteMailDelivery_quoteVersionId_createdAt_idx" ON "QuoteMailDelivery"("quoteVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteMailDelivery_quoteId_createdAt_idx" ON "QuoteMailDelivery"("quoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "QuoteMailDelivery" ADD CONSTRAINT "QuoteMailDelivery_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteMailDelivery" ADD CONSTRAINT "QuoteMailDelivery_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "QuoteVersion"("id", "quoteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteMailDelivery" ADD CONSTRAINT "QuoteMailDelivery_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "QuoteMailDelivery" ADD CONSTRAINT "QuoteMailDelivery_outcome_check"
 CHECK ("outcome" IN ('SENT', 'FAILED', 'INDETERMINATE'));
