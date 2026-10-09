-- A vizmeresi ajanlas (kartya 2b3983e1): a JEV allitasa arrol, mely vizparametert
-- mozgatja a termek, es merre. Nem bolti teny (public = false), az AI latja.
-- Az INSERT betuire az `additionSql` kimenete (attribute-definitions.spec.ts orzi).
INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES
('waterParameterEffects', 'Mozgatott vízparaméterek', 'TEXT', NULL, NULL, 'PRODUCT', 'C', 'VALUE', NULL, false, true, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
