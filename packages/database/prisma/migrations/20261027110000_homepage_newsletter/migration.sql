-- The newsletter row above the footer (Balázs, 2026-10-27, kirakat-lablec-kep).
-- Nullable: NULL keeps the storefront's own row, so the rows written before this change read as today.
-- AlterTable
ALTER TABLE "HomepageContent" ADD COLUMN     "newsletter" JSONB;
