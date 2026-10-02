-- A kimenő számlák kifizetett-jelölésének naplója, minden forrásra (acrobot 25989,
-- 26001; murena 25999): a Számlázz.hu jóváírás-rögzítése additiv=true mellett
-- nem idempotens, az egyedi kulcs (forrás, számla, forrás-oldali azonosító) véd.
-- CreateEnum
CREATE TYPE "OutgoingPaymentMarkState" AS ENUM ('PLANNED', 'WRITTEN', 'ALREADY_PAID', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OutgoingPaymentMarkSource" AS ENUM ('GLS_COD', 'SIMPLEPAY', 'FOXPOST');

-- CreateTable
CREATE TABLE "OutgoingPaymentMark" (
    "id" TEXT NOT NULL,
    "source" "OutgoingPaymentMarkSource" NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "markDate" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "state" "OutgoingPaymentMarkState" NOT NULL,
    "requestSha256" TEXT,
    "responseCode" TEXT,
    "responseMessage" TEXT,
    "outstanding" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingPaymentMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutgoingPaymentMark_source_invoiceNumber_sourceRef_key" ON "OutgoingPaymentMark"("source", "invoiceNumber", "sourceRef");
