-- EGY SZÁMLÁHOZ LEGFELJEBB EGY SZTORNÓ (számlázási brief, 1. pont, Balázs
-- 2026-10-12 09:44 UTC). A sztornó egy saját `Invoice` sor (`documentType`
-- STORNO, `referencedInvoiceId` az eredeti). Két egyidejű sztornó-kattintásból
-- így csak egy sor jöhet létre, és csak egy Számlázz.hu-hívás indul: a másik
-- egyedi-kulcs hibát kap, mielőtt bármit hívna.
-- Részleges index, ezért nem a sémában áll (a Prisma nem írja le); a sémában
-- az `Invoice` modell kommentje mutat ide.
CREATE UNIQUE INDEX "Invoice_one_storno_per_invoice"
  ON "Invoice" ("referencedInvoiceId")
  WHERE "documentType" = 'STORNO';

-- A sztornó visszaadja a számla eladását; a UNAS-kimenő sor forrása.
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'BILLING_STORNO';
