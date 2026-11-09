-- The user's theme, saved on the account (Balazs, 2026-11-09: the phone's browser forgot it every time). NULL: not
-- chosen yet, the browser's own (local) setting decides. Additive, nullable.

-- CreateEnum
CREATE TYPE "UserThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "themePreference" "UserThemePreference";
