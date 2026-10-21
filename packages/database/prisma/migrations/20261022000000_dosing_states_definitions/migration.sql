-- A harom adagolasi allapot (Balazs, 2026-10-21 22:08 UTC, kartya 85c38ab1): dosingMode,
-- dosingGuidance, dosingTests. Nem bolti tenyek (public = false), az AI latja.
-- Az INSERT-ek betuire az `additionSql` kimenete (attribute-definitions.spec.ts orzi).
INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES
('dosingMode', 'Adagolás módja', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, false, true, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES
('dosingGuidance', 'Adagolási útmutató (a gyártó szerint)', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'PROSE', NULL, false, true, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES
('dosingTests', 'Adagolás előtt mérendő', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, false, true, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
