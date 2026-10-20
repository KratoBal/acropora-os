-- The administrator's switch: send the home page content to the web shop (default off).
-- AlterTable
ALTER TABLE "HomepageContent" ADD COLUMN "projectionEnabled" BOOLEAN NOT NULL DEFAULT false;
