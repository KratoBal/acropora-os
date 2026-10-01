-- A Számlázz.hu-ból kapott kimenő számla kifizetései (a `kifizetesek` elem).
-- AlterTable
ALTER TABLE "ExternalBillingDocument" ADD COLUMN     "lastPaymentDate" DATE,
ADD COLUMN     "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "paymentsKnown" BOOLEAN;

