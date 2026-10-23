-- Barcodes filled from an approved supplier price-list pair were stored with source
-- IMPORT before SUPPLIER_PRICE_LIST existed. The audit row written with each fill
-- (entityId = the ProductBarcode id) says exactly which ones they are.
-- Separate migration: a new enum value cannot be used in the transaction that adds it.
UPDATE "ProductBarcode"
SET "source" = 'SUPPLIER_PRICE_LIST'
WHERE "id" IN (
  SELECT "entityId"
  FROM "AuditLog"
  WHERE "action" = 'product-barcode.added-from-price-list'
    AND "entityType" = 'ProductBarcode'
);
