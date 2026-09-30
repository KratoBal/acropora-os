-- A kiállított számla készlethatása (Balázs kérése, 2026-09-30).
--
-- 1. Új UNAS-kimenő forrás: a számla a POS-eladással azonos úton von le, és a
--    UNAS-termék kimenő sora ezzel az értékkel jelöli, honnan jött.
-- 2. A soronkénti eredmény (MOVED, NOT_STOCKED, VARIANT_NOT_CHOSEN, ...): a
--    kiállítás készletkönyvelése írja; a régi sorokra és a vázlatokra NULL.

-- AlterEnum
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'BILLING_INVOICE';

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "stockOutcome" TEXT;
