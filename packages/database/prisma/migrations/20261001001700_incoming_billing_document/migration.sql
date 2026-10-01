-- A Számlázz.hu-ból kapott bejövő számlák vetítése a Számlázás „Bejövő számlák”
-- nézetéhez (acrobot 25869). Új tábla, a meglévőkhöz nem nyúl; a nyers üzenetből
-- újraépíthető.
-- CreateTable
CREATE TABLE "IncomingBillingDocument" (
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
    "exchangeRate" DECIMAL(18,6),
    "exchangeBank" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierTaxNumber" TEXT,
    "supplierEuTaxNumber" TEXT,
    "supplierAddress" TEXT,
    "supplierBankAccount" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerTaxNumber" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "vatSummary" JSONB NOT NULL,
    "payments" JSONB NOT NULL,
    "paymentsKnown" BOOLEAN NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL,
    "lastPaymentDate" DATE,
    "note" TEXT,
    "orderNumber" TEXT,
    "referencedInvoiceNumber" TEXT,
    "referencedProformaNumber" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "sourceDocumentId" TEXT,
    "hasPdf" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingBillingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncomingBillingDocument_issueDate_idx" ON "IncomingBillingDocument"("issueDate");

-- CreateIndex
CREATE INDEX "IncomingBillingDocument_fulfillmentDate_idx" ON "IncomingBillingDocument"("fulfillmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingBillingDocument_source_externalId_key" ON "IncomingBillingDocument"("source", "externalId");

