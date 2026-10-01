-- Számla-begyűjtés: a saját kimenő számlánk másolatainak száma a futáson.

-- AlterTable
ALTER TABLE "InvoiceCollectionRun" ADD COLUMN     "ownInvoiceCount" INTEGER NOT NULL DEFAULT 0;

