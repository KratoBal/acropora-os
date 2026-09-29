-- A product the Medusa projection skips: a product created from a supplier
-- invoice line goes to the webshop (as a draft only) when the person asked
-- for it. Default false: every existing product is projected as before.
ALTER TABLE "Product" ADD COLUMN "webshopExcluded" BOOLEAN NOT NULL DEFAULT false;
