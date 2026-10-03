-- CreateEnum
CREATE TYPE "ProductEnrichmentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'LIMIT_REACHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductEnrichmentFetchOutcome" AS ENUM ('FETCHED', 'UNAVAILABLE', 'REFUSED');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "websiteUrl" TEXT;

-- CreateTable
CREATE TABLE "ProductEnrichmentRun" (
    "id" TEXT NOT NULL,
    "status" "ProductEnrichmentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "requestedById" TEXT NOT NULL,
    "productLimit" INTEGER NOT NULL,
    "requestLimit" INTEGER NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductEnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentRunProduct" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "fieldCount" INTEGER NOT NULL,

    CONSTRAINT "ProductEnrichmentRunProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentSourceFetch" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "sourceKind" VARCHAR(32) NOT NULL,
    "url" TEXT NOT NULL,
    "outcome" "ProductEnrichmentFetchOutcome" NOT NULL,
    "reason" VARCHAR(64),
    "httpStatus" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "fieldCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductEnrichmentSourceFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentFieldResult" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "field" VARCHAR(48) NOT NULL,
    "tier" VARCHAR(1) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "value" TEXT,
    "sourceType" VARCHAR(32),
    "sourceRef" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "currentValue" TEXT,
    "evidence" JSONB NOT NULL,
    "conflicts" JSONB,

    CONSTRAINT "ProductEnrichmentFieldResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEnrichmentRun_startedAt_idx" ON "ProductEnrichmentRun"("startedAt");

-- CreateIndex
CREATE INDEX "ProductEnrichmentRunProduct_productId_checkedAt_idx" ON "ProductEnrichmentRunProduct"("productId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEnrichmentRunProduct_runId_productId_key" ON "ProductEnrichmentRunProduct"("runId", "productId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentSourceFetch_checkId_idx" ON "ProductEnrichmentSourceFetch"("checkId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentFieldResult_status_idx" ON "ProductEnrichmentFieldResult"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEnrichmentFieldResult_checkId_field_key" ON "ProductEnrichmentFieldResult"("checkId", "field");

-- AddForeignKey
ALTER TABLE "ProductEnrichmentRun" ADD CONSTRAINT "ProductEnrichmentRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentRunProduct" ADD CONSTRAINT "ProductEnrichmentRunProduct_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductEnrichmentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentRunProduct" ADD CONSTRAINT "ProductEnrichmentRunProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentSourceFetch" ADD CONSTRAINT "ProductEnrichmentSourceFetch_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ProductEnrichmentRunProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentFieldResult" ADD CONSTRAINT "ProductEnrichmentFieldResult_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ProductEnrichmentRunProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

