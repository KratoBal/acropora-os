-- A knowledge article is marked once, by its first citation, and never
-- unmarked (research S5, acrobot 37001, 37006). Additive: one nullable column.
ALTER TABLE "ArticleBody" ADD COLUMN "knowledgeSince" TIMESTAMP(3);

-- An article cited before the mark existed is a knowledge article since its
-- first citation.
UPDATE "ArticleBody" AS b
SET "knowledgeSince" = c.first
FROM (
  SELECT "contentId", min("createdAt") AS first
  FROM "ArticleCitation"
  GROUP BY "contentId"
) AS c
WHERE c."contentId" = b."contentId" AND b."knowledgeSince" IS NULL;
