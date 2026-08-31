-- The two HTML flags are the claim UNAS makes about its own content, not a
-- measurement of it. This comment exists so that the next person who reads the
-- column sees the numbers before writing an `if` on it.
--
-- The schema.prisma doc comments carry the same warning, and they are the
-- durable copy: Prisma does not read column comments, so a database rebuilt
-- from the schema alone will not have these. If the two ever disagree, the
-- schema and the shared type are right and this file is stale.

COMMENT ON COLUMN "UnasProductSnapshot"."descriptionShortIsHtml" IS
  'The claim UNAS makes about its own content, NOT our measurement of it. Do not branch on it. Measured 2026-08-28 over 1893 products: the positive value is reliable (0 cases of a true flag over text that holds no tags), the negative value is not - 774 of the 884 short descriptions it calls plain text do hold tags (87.6 percent). NULL only when the response carried no description block at all. To learn whether a text holds markup, read the text: plainText() in ai-product-search.text.ts.';

COMMENT ON COLUMN "UnasProductSnapshot"."descriptionLongIsHtml" IS
  'The claim UNAS makes about its own content, NOT our measurement of it. Do not branch on it. Measured 2026-08-28 over 1893 products: the positive value is reliable (0 cases of a true flag over text that holds no tags), the negative value is wrong for 47 of the 106 long descriptions it calls plain text (44.3 percent) - better than the short one, and still not usable. NULL only when the response carried no description block at all. To learn whether a text holds markup, read the text: plainText() in ai-product-search.text.ts.';
