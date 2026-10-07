-- CreateEnum
CREATE TYPE "IncomingDocumentReviewState" AS ENUM ('TO_REVIEW', 'VERIFIED');

-- CreateTable
CREATE TABLE "IncomingDocumentReading" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "state" "IncomingDocumentReviewState" NOT NULL DEFAULT 'TO_REVIEW',
    "supplierName" TEXT,
    "supplierTaxNumber" TEXT,
    "supplierEuTaxNumber" TEXT,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "fulfillmentDate" DATE,
    "dueDate" DATE,
    "currency" VARCHAR(3),
    "netAmount" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "grossAmount" DECIMAL(18,2),
    "sources" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "hasText" BOOLEAN NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "incomingBillingDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingDocumentReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingDocumentReading_documentId_key" ON "IncomingDocumentReading"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingDocumentReading_incomingBillingDocumentId_key" ON "IncomingDocumentReading"("incomingBillingDocumentId");

-- CreateIndex
CREATE INDEX "IncomingDocumentReading_state_idx" ON "IncomingDocumentReading"("state");

-- AddForeignKey
ALTER TABLE "IncomingDocumentReading" ADD CONSTRAINT "IncomingDocumentReading_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IncomingSupplierDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingDocumentReading" ADD CONSTRAINT "IncomingDocumentReading_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A JÓVÁHAGYOTT SOR KÖTELEZŐ MEZŐI (kártya e4c3b0fb): VERIFIED csak akkor lehet,
-- ha a könyvelőnek kellő adat megvan és a jóváhagyás ideje rögzítve. A
-- teljesítés és a határidő nem kötelező (sok külföldi számlán nincs ilyen címke).
ALTER TABLE "IncomingDocumentReading" ADD CONSTRAINT "IncomingDocumentReading_verified_complete" CHECK (
  "state" <> 'VERIFIED' OR (
    "supplierName" IS NOT NULL
    AND "documentNumber" IS NOT NULL
    AND "issueDate" IS NOT NULL
    AND "currency" IS NOT NULL
    AND "netAmount" IS NOT NULL
    AND "vatAmount" IS NOT NULL
    AND "grossAmount" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
  )
);
