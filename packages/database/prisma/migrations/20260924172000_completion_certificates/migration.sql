-- CreateEnum
CREATE TYPE "CompletionCertificateDocumentType" AS ENUM ('GENERATED_FORM', 'SIGNED_FORM');

-- CreateTable
CREATE TABLE "CompletionCertificate" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompletionCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletionCertificateLineItem" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "CompletionCertificateLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletionCertificateDocument" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "type" "CompletionCertificateDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletionCertificateDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletionCertificate_serviceJobId_key" ON "CompletionCertificate"("serviceJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletionCertificate_number_key" ON "CompletionCertificate"("number");

-- CreateIndex
CREATE INDEX "CompletionCertificate_serviceJobId_idx" ON "CompletionCertificate"("serviceJobId");

-- CreateIndex
CREATE INDEX "CompletionCertificateLineItem_certificateId_idx" ON "CompletionCertificateLineItem"("certificateId");

-- CreateIndex
CREATE INDEX "CompletionCertificateDocument_certificateId_createdAt_idx" ON "CompletionCertificateDocument"("certificateId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompletionCertificate" ADD CONSTRAINT "CompletionCertificate_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionCertificateLineItem" ADD CONSTRAINT "CompletionCertificateLineItem_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "CompletionCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionCertificateDocument" ADD CONSTRAINT "CompletionCertificateDocument_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "CompletionCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

