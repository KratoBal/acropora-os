-- A beszerzési számla sztornója (acrobot 28092, Balázs „A 1”): ki, mikor, miért.
ALTER TABLE "PurchaseInvoice" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" TEXT,
ADD COLUMN "cancelReason" TEXT;

-- A (szállító, számlaszám) egyedisége csak a nem sztornózott számlákra áll: a
-- sztornózott számla száma újra rögzíthető. Ugyanaz az index-név marad, mert a
-- rögzítés és a javítás a P2002 célpontjából erre a névre ismer rá.
DROP INDEX "PurchaseInvoice_supplierId_supplierInvoiceNumber_key";
CREATE UNIQUE INDEX "PurchaseInvoice_supplierId_supplierInvoiceNumber_key" ON "PurchaseInvoice"("supplierId", "supplierInvoiceNumber") WHERE "status" <> 'CANCELLED';
