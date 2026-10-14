-- Contract partial billing (task t-20261014-szerzodesek-reszteljesitese-szamlazasa-d510):
-- an invoice line can point at the purchase-contract item it bills. The invoiced quantity
-- of an item is computed from these lines, never stored. Nullable: every existing line
-- stays as it is (the past partial invoice is linked only by a separate, approved step).
-- RESTRICT: an item an invoice points at cannot be deleted from the contract.
ALTER TABLE "InvoiceLine" ADD COLUMN "contractItemId" TEXT;

CREATE INDEX "InvoiceLine_contractItemId_idx" ON "InvoiceLine"("contractItemId");

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
