-- "Papiron megvan" mark on an outgoing invoice, own and external (Balazs, 2026-11-03). Additive: two nullable columns, no existing row changes.
-- ROLLBACK: ALTER TABLE "Invoice" DROP COLUMN "paperOriginalAt"; ALTER TABLE "ExternalBillingDocument" DROP COLUMN "paperOriginalAt";
ALTER TABLE "Invoice" ADD COLUMN "paperOriginalAt" TIMESTAMP(3);
ALTER TABLE "ExternalBillingDocument" ADD COLUMN "paperOriginalAt" TIMESTAMP(3);
