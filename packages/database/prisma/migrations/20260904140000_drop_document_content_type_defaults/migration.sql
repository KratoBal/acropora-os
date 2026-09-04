-- A feltöltő közös mag minden új dokumentumhoz a bájtokból felismert típust
-- ír. Ezek a defaultok ezt eddig el tudták fedni egy hiányzó hívói mezővel.
--
-- Szándékosan NINCS UPDATE: a már tárolt hibás típusú sorok javítása külön
-- adatjavítási döntés, ez a migráció érintetlenül hagyja őket.
ALTER TABLE "AssetDocument"
  ALTER COLUMN "contentType" DROP DEFAULT;

ALTER TABLE "WorksheetDocument"
  ALTER COLUMN "contentType" DROP DEFAULT;
