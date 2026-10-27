-- The home page logo strip's brands, in order (Balázs, 2026-10-27): a list of Brand ids.
-- Nullable: NULL is "not set", the storefront keeps its row of brand names, so the rows written before this change read as today.
-- AlterTable
ALTER TABLE "HomepageContent" ADD COLUMN     "featuredBrandIds" JSONB;
