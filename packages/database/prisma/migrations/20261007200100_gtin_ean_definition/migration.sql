-- SEO P0 PR 4: az `ean` definicio atallitasa (C3, a P0 terv 230. sora).
--
-- Az elfogadott EAN nem teny tobbe, hanem `ProductBarcode` sor (VARIANT_BARCODE),
-- valtozatonkent (VARIANT), es nem megy ki tenykent (public = false): a kodot a
-- vetites a valtozat `ean`/`upc` mezojebe viszi. Kulon migracio, mert az enum uj
-- erteke a hozzaado tranzakcioban meg nem hasznalhato.
--
-- Az `apps/api/src/products/attributes/attribute-definitions.ts`
-- `ATTRIBUTE_DEFINITION_CHANGES` listajabol irodott; a teszt orzi, hogy a ketto egyezik.

UPDATE "AttributeDefinition" SET "scope" = 'VARIANT', "medusaNativeField" = 'VARIANT_BARCODE', "public" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'ean';
