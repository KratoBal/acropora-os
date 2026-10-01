-- A begyűjtő szabály-változata a futáson (acrobot 25750): ha a kódé más, az
-- UNMATCHED levelek újraolvasódnak. A meglévő futásoké NULL, tehát az első új
-- futás egyszer mindent újraértékel, amit eddig UNMATCHED-nak ítélt.

-- AlterTable
ALTER TABLE "InvoiceCollectionRun" ADD COLUMN     "rulesVersion" TEXT;
