-- A NAV szamlasor sorszama es eredeti szovege a beszerzesi szamlasoron (#1199 A-007).
-- Additiv, nullazhato oszlopok: a meglevo sorokhoz nem nyul, es nincs benne
-- visszatoltes. A meglevo sorokat egy kulon, alapbol csak olvaso futtato tolti,
-- csak az egyertelmuen parosithato sorokra (apps/api/scripts/backfill-purchase-line-nav-source.mjs).

-- AlterTable
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN     "navLineDescription" TEXT,
ADD COLUMN     "navLineNumber" INTEGER;
