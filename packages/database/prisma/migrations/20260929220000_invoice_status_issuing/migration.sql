-- A real Számlázz.hu issue in progress, outcome not yet known (146ccc61).
-- Adding an enum value only: no existing row changes.
ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUING';
