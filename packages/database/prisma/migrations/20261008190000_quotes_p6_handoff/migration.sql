-- #1582 P6: a project started from an accepted quote (QuoteProjectHandoff),
-- and the project's way back to its quote (Project.sourceQuoteId).
-- New table and a nullable column: no existing row is affected.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sourceQuoteId" TEXT;

-- CreateTable
CREATE TABLE "QuoteProjectHandoff" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "acceptanceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planHash" VARCHAR(64) NOT NULL,
    "plan" JSONB NOT NULL,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteProjectHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteProjectHandoff_quoteId_key" ON "QuoteProjectHandoff"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteProjectHandoff_acceptanceId_key" ON "QuoteProjectHandoff"("acceptanceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteProjectHandoff_projectId_key" ON "QuoteProjectHandoff"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceQuoteId_key" ON "Project"("sourceQuoteId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteProjectHandoff" ADD CONSTRAINT "QuoteProjectHandoff_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteProjectHandoff" ADD CONSTRAINT "QuoteProjectHandoff_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "QuoteVersion"("id", "quoteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteProjectHandoff" ADD CONSTRAINT "QuoteProjectHandoff_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "QuoteAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteProjectHandoff" ADD CONSTRAINT "QuoteProjectHandoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteProjectHandoff" ADD CONSTRAINT "QuoteProjectHandoff_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

