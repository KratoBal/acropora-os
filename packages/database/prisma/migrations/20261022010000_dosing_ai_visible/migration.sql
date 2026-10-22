-- Product Knowledge 4. szelet (kartya 85c38ab1): az AI chat olvassa a gyartoi adagolast.
-- Csak az aiVisible valtozik; a hatokor, a nativ cel es a nyilvanossag a mai erteke.
-- Az UPDATE betuire a `changeSql` kimenete (attribute-definitions.spec.ts orzi).
UPDATE "AttributeDefinition" SET "scope" = 'PRODUCT', "medusaNativeField" = NULL, "public" = true, "aiVisible" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'dosing';
