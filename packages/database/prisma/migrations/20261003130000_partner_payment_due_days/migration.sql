-- Payment term in days for invoices we issue, set per partner.
-- Null keeps the invoice default (8 days).
ALTER TABLE "Supplier" ADD COLUMN "paymentDueDays" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "paymentDueDays" INTEGER;

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_paymentDueDays_range"
  CHECK ("paymentDueDays" IS NULL OR ("paymentDueDays" >= 0 AND "paymentDueDays" <= 365));
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_paymentDueDays_range"
  CHECK ("paymentDueDays" IS NULL OR ("paymentDueDays" >= 0 AND "paymentDueDays" <= 365));
