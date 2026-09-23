-- Gépi szerep az eszköz-törzsadat importnak (kanban 8c77cf3e, Balázs döntése,
-- 2026-09-23): pontosan annyi jogot ad, amennyit a betöltő négy hívása
-- ténylegesen használ (service.view, service.manage) -- nem a SERVICE
-- szerepből vesz el, mert az elvétel meghagyná azt, amit senki nem vett
-- észre. Meglévő felhasználói sorokat nem ír át.
ALTER TYPE "UserRole" ADD VALUE 'ASSET_IMPORT_AGENT';
