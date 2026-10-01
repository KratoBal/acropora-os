-- A Jev levél-válogatás javaslata (4. szelet, acrobot 25803): a begyűjtött, Jev
-- szerint bejövő számla SUGGESTED állapotban vár emberi jóváhagyásra, és addig nem
-- jelölt. Additív: az új oszlopok NULL-ozhatók vagy alapértékesek, a meglévő sorok
-- változatlanok.
ALTER TABLE "InvoiceCollectionRun" ADD COLUMN     "suggestedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "reviewState" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "suggestionConfidence" DECIMAL(5,4),
ADD COLUMN     "suggestionDecisionRunId" TEXT;

CREATE INDEX "IncomingSupplierDocument_reviewState_idx" ON "IncomingSupplierDocument"("reviewState");
