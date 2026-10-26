-- The home page blocks (order and visibility) and the footer (Balázs, 2026-10-26).
-- Both nullable: NULL keeps the storefront's own order and footer, so the rows written before this change read as today.
-- AlterTable
ALTER TABLE "HomepageContent" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "footer" JSONB;
