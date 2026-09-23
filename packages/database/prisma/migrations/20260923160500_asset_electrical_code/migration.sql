-- Az eszköz-táblázat első oszlopa ("MAT kód / Elektromos"), saját mezőként.
-- Balázs kérése, 2026-09-23 (kanban 8c77cf3e). A migráció kizárólag HOZZÁAD:
-- egy nullázható oszlopot az Asset táblán, meglévő sort nem érint.
ALTER TABLE "Asset" ADD COLUMN "electricalCode" TEXT;

CREATE INDEX "Asset_electricalCode_idx" ON "Asset"("electricalCode");
