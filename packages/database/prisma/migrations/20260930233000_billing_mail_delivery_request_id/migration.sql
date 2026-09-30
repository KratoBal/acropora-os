-- A kiküldés idempotenciája (Számlázás, szerződés: POST :id/email): a kliens
-- kérés-azonosítója. Ugyanazzal az azonosítóval küldött második kérés a
-- meglévő kézbesítést kapja vissza. NULL-ozható, a régi sorokra NULL; több NULL
-- nem ütközik az egyedi indexben.

-- AlterTable
ALTER TABLE "BillingDocumentMailDelivery" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BillingDocumentMailDelivery_requestId_key" ON "BillingDocumentMailDelivery"("requestId");
