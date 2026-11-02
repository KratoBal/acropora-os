-- "Papiron megvan" mark on an incoming invoice row (Balazs, 2026-11-02). Additive: one nullable column, no existing row changes.
-- ROLLBACK: ALTER TABLE "IncomingBillingDocument" DROP COLUMN "paperOriginalAt";
ALTER TABLE "IncomingBillingDocument" ADD COLUMN "paperOriginalAt" TIMESTAMP(3);
