-- The stock flags are the shop's claim about itself, not a measurement - and
-- one of them is renamed on the way in, which is the part a reader cannot see
-- from the column name alone.
--
-- The schema.prisma doc comments carry the same warning, and they are the
-- durable copy: Prisma does not read column comments, so a database rebuilt
-- from the schema alone will not have these. If the two ever disagree, the
-- schema and the shared type are right and this file is stale.

COMMENT ON COLUMN "UnasProductSnapshot"."backorderAllowed" IS
  'The claim UNAS makes, RENAMED on the way in: it arrives as StockStatus.Empty, which is a STATE ("empty"), and is stored under a name that reads as a RULE ("backorder allowed"). It does not tell you what happens when someone orders a product at zero stock; it tells you what the shop says about itself. NULL means the source said nothing - a distinction that is lost downstream, where ChannelListing.backorderAllowed writes it with a `?? false` default.';

COMMENT ON COLUMN "UnasProductSnapshot"."variantStockEnabled" IS
  'The claim UNAS makes, from StockStatus.Variant. The name suggests a setting we control ("enabled"); the source field is a state. Nothing reads this column today - it is a stored claim, not a measurement. Measure before branching on it, the way the HTML flags were measured.';

COMMENT ON COLUMN "ChannelListing"."backorderAllowed" IS
  'Written from UnasProductSnapshot.backorderAllowed with a `?? false` default, and that default is where a distinction disappears: in the snapshot NULL means the source did not say, here it becomes false, indistinguishable from the shop explicitly saying no. It is the narrower of the two readings, so it is defensible - but anyone writing an `if` on this column should know that false covers two different things.';
