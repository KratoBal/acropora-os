-- Reverts 20260929190000_product_webshop_excluded (#1230). Balázs postponed
-- the "into the webshop too, as a draft" choice until the webshop goes live
-- (2026-09-28). The earlier migration stays in the history, because it may
-- already have run on a database; this one removes the column after it.
ALTER TABLE "Product" DROP COLUMN "webshopExcluded";
