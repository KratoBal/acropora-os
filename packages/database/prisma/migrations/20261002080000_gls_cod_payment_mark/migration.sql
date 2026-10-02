-- A GLS utánvét kifizetett-jelölésének naplója (acrobot 25989): a Számlázz.hu
-- jóváírás-rögzítése additiv=true mellett nem idempotens, az egyedi kulcs véd.
-- CreateEnum
CREATE TYPE "GlsCodPaymentMarkState" AS ENUM ('PLANNED', 'WRITTEN', 'ALREADY_PAID', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "GlsCodPaymentMark" (
    "id" TEXT NOT NULL,
    "transferDate" DATE NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "creditId" TEXT NOT NULL,
    "state" "GlsCodPaymentMarkState" NOT NULL,
    "requestSha256" TEXT,
    "responseCode" TEXT,
    "responseMessage" TEXT,
    "outstanding" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlsCodPaymentMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlsCodPaymentMark_invoiceNumber_transferDate_key" ON "GlsCodPaymentMark"("invoiceNumber", "transferDate");
