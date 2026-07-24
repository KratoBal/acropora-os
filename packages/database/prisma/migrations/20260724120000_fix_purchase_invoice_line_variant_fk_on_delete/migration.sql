-- DropForeignKey
ALTER TABLE "PurchaseInvoiceLine" DROP CONSTRAINT "PurchaseInvoiceLine_variantId_fkey";

-- AddForeignKey
-- variantId opcionálissá vált (lásd 20260724100000_purchase_invoice_line_optional_variant),
-- ezért az ON DELETE szabálynak is a Prisma opcionális-kapcsolat alapértelmezését
-- (SET NULL) kell követnie a korábbi RESTRICT helyett - ha egy ProductVariant törlődik,
-- a rá hivatkozó számlasor variantId-ja NULL-ra áll, nem blokkolja a törlést.
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
