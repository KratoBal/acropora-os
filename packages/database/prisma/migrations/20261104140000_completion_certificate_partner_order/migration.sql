-- A completion certificate (TIG) for a partner order (Megrendelések S2). Additive: a nullable source column, the service-job source made nullable, two nullable line columns, two indexes, two foreign keys and one CHECK; every existing row has serviceJobId set and partnerOrderId NULL, which the CHECK accepts.
-- ROLLBACK (only while no partner-order TIG exists): ALTER TABLE "CompletionCertificate" DROP CONSTRAINT "CompletionCertificate_exactly_one_source", DROP CONSTRAINT "CompletionCertificate_partnerOrderId_fkey", DROP COLUMN "partnerOrderId", ALTER COLUMN "serviceJobId" SET NOT NULL; ALTER TABLE "CompletionCertificateLineItem" DROP CONSTRAINT "CompletionCertificateLineItem_quoteItemId_fkey", DROP COLUMN "quoteItemId", DROP COLUMN "quantityUnit";
ALTER TABLE "CompletionCertificate" ADD COLUMN     "partnerOrderId" TEXT,
ALTER COLUMN "serviceJobId" DROP NOT NULL;

ALTER TABLE "CompletionCertificateLineItem" ADD COLUMN     "quantityUnit" TEXT,
ADD COLUMN     "quoteItemId" TEXT;

CREATE INDEX "CompletionCertificate_partnerOrderId_idx" ON "CompletionCertificate"("partnerOrderId");

CREATE INDEX "CompletionCertificateLineItem_quoteItemId_idx" ON "CompletionCertificateLineItem"("quoteItemId");

ALTER TABLE "CompletionCertificate" ADD CONSTRAINT "CompletionCertificate_partnerOrderId_fkey" FOREIGN KEY ("partnerOrderId") REFERENCES "PartnerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompletionCertificateLineItem" ADD CONSTRAINT "CompletionCertificateLineItem_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "QuoteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- exactly one source: a TIG certifies either a service job or a partner order, never both and never neither
ALTER TABLE "CompletionCertificate"
  ADD CONSTRAINT "CompletionCertificate_exactly_one_source"
  CHECK (("serviceJobId" IS NULL) <> ("partnerOrderId" IS NULL));
