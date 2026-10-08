-- #1582 P5a: a project reservation from a purchase receipt or from a quote's
-- BOM item (the handoff, P6).

-- Every row today came from a receipt and names its invoice line. Checked
-- first: if one does not, the CHECK below could not be added, and this says
-- why instead of a constraint error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProjectInventoryReservation" WHERE "purchaseInvoiceLineId" IS NULL
  ) THEN
    RAISE EXCEPTION 'P5a: a ProjectInventoryReservation row without an invoice line';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ProjectReservationOrigin" AS ENUM ('PURCHASE_RECEIPT', 'QUOTE_HANDOFF');

-- AlterTable
ALTER TABLE "ProjectInventoryReservation" ADD COLUMN     "origin" "ProjectReservationOrigin" NOT NULL DEFAULT 'PURCHASE_RECEIPT',
ADD COLUMN     "quoteBomItemId" TEXT,
ALTER COLUMN "purchaseInvoiceLineId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInventoryReservation_quoteBomItemId_stockItemId_key" ON "ProjectInventoryReservation"("quoteBomItemId", "stockItemId");

-- AddForeignKey
ALTER TABLE "ProjectInventoryReservation" ADD CONSTRAINT "ProjectInventoryReservation_quoteBomItemId_fkey" FOREIGN KEY ("quoteBomItemId") REFERENCES "QuoteBomItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- each row has exactly its own origin's parent
ALTER TABLE "ProjectInventoryReservation" ADD CONSTRAINT "ProjectInventoryReservation_origin_parent_check" CHECK (
  ("origin" = 'PURCHASE_RECEIPT' AND "purchaseInvoiceLineId" IS NOT NULL AND "quoteBomItemId" IS NULL)
  OR ("origin" = 'QUOTE_HANDOFF' AND "quoteBomItemId" IS NOT NULL AND "purchaseInvoiceLineId" IS NULL)
);
