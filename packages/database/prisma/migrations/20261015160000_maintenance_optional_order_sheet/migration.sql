-- Maintenance flow with an optional order sheet (survey t-20261015-karbantartas-felmeres,
-- slice S2, task t-20261015-karbantartas-s2-sema). Additive only: no existing row changes.
--   * ServiceJobContractItem: the contract items a maintenance job covers when it has no
--     order sheet, with description and price COPIED at job creation (like
--     MaintenanceOrderItem), so a later contract price change does not reprice done work.
--   * MaintenanceOrder.source: GENERATED (every existing row) or CUSTOMER_FORM (the
--     customer's own order sheet, uploaded).
--   * ContractKind.REPAIR and MaintenanceOrderDocumentType.CUSTOMER_FORM.
-- ROLLBACK: the table, the column and the MaintenanceOrderSource type can be dropped. The
-- two ADD VALUE enum values CANNOT be removed without rebuilding the type; an unused enum
-- value is harmless, so a rollback leaves them in place.
-- CreateEnum
CREATE TYPE "MaintenanceOrderSource" AS ENUM ('GENERATED', 'CUSTOMER_FORM');

-- AlterEnum
ALTER TYPE "ContractKind" ADD VALUE 'REPAIR';

-- AlterEnum
ALTER TYPE "MaintenanceOrderDocumentType" ADD VALUE 'CUSTOMER_FORM';

-- AlterTable
ALTER TABLE "MaintenanceOrder" ADD COLUMN     "source" "MaintenanceOrderSource" NOT NULL DEFAULT 'GENERATED';

-- CreateTable
CREATE TABLE "ServiceJobContractItem" (
    "serviceJobId" TEXT NOT NULL,
    "contractItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "ServiceJobContractItem_pkey" PRIMARY KEY ("serviceJobId","contractItemId")
);

-- CreateIndex
CREATE INDEX "ServiceJobContractItem_contractItemId_idx" ON "ServiceJobContractItem"("contractItemId");

-- AddForeignKey
ALTER TABLE "ServiceJobContractItem" ADD CONSTRAINT "ServiceJobContractItem_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobContractItem" ADD CONSTRAINT "ServiceJobContractItem_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

