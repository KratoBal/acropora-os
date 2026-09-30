-- A fizetési felszólítás-levelek számlálója a beszállítói levél-behúzás
-- futásán (Balázs, 2026-09-30 12:23 UTC, message_id 1554831001858080882: a
-- felszólításból, amibe a számlát is becsatolják, NE legyen várható
-- beérkezés). Egy új oszlop DEFAULT 0-val: a régi futásokra igaz, hiszen
-- azok még nem ismerték fel a felszólítást. Meglévő sort nem ír át.

-- AlterTable
ALTER TABLE "SupplierInvoiceMailSyncRun" ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;
