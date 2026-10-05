-- One row per own invoice number (acrobot 26208): the Számlázz.hu row records
-- the eBIZ id its PDF came from, so the next eBIZ sync finds it.
-- AlterTable
ALTER TABLE "ExternalBillingDocument" ADD COLUMN     "ebizExternalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBillingDocument_ebizExternalId_key" ON "ExternalBillingDocument"("ebizExternalId");

-- CreateIndex
CREATE INDEX "ExternalBillingDocument_documentNumber_idx" ON "ExternalBillingDocument"("documentNumber");

