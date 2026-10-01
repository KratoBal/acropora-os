-- A Számlázz.hu-ból kapott kimenő számlák vetítése a Számlázás listájához (acrobot
-- 25812). Új tábla, a meglévőkhöz nem nyúl; a nyers üzenetből újraépíthető.
-- CreateTable
CREATE TABLE "ExternalBillingDocument" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SZAMLAZZ',
    "externalId" TEXT NOT NULL,
    "feedMessageId" TEXT NOT NULL,
    "feedReceivedAt" TIMESTAMP(3) NOT NULL,
    "versionCount" INTEGER NOT NULL DEFAULT 1,
    "kindCode" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "electronic" BOOLEAN NOT NULL,
    "issueDate" DATE NOT NULL,
    "fulfillmentDate" DATE,
    "dueDate" DATE,
    "paymentMethod" TEXT,
    "currency" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerTaxNumber" TEXT,
    "customerAddress" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalBillingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalBillingDocument_issueDate_idx" ON "ExternalBillingDocument"("issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBillingDocument_source_externalId_key" ON "ExternalBillingDocument"("source", "externalId");

