-- These are manually curated datasheet values. They remain nullable so an
-- incomplete datasheet cannot silently turn into a weak recommendation.
CREATE TYPE "ElhelyezesiIgeny" AS ENUM ('GYENGE', 'KOZEPES', 'EROS');

ALTER TABLE "ProductDatasheet"
  ADD COLUMN "fenyIgeny" "ElhelyezesiIgeny",
  ADD COLUMN "aramlasIgeny" "ElhelyezesiIgeny";
