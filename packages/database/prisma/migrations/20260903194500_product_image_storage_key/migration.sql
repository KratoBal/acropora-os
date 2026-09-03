-- A TERMEKKEP BAJTJAI A MI TAROLONKBAN.
--
-- Az `url` a FORRAS cime (ma a UNAS taroloja), a `storageKey` pedig azt mondja
-- meg, hogy a kep bajtjai nalunk is ott allnak-e.
--
-- NINCS `CHECK` MEGKOTES, ES EZ SZANDEKOS KULONBSEG A DOKUMENTUMOKHOZ KEPEST.
-- Az `AssetDocument` es a `WorksheetDocument` eseteben a tartalom PONTOSAN az
-- egyik helyen all (`content` XOR `storageKey`), mert ott a bajtok a mieink es
-- egy sor ket peldanya ellentmondas lenne. Itt az `url` az AZONOSSAG resze -- a
-- `[productId, url]` egyedi kulcs erre epul --, tehat a masolat elkeszulte utan
-- is meg KELL maradnia. Egy XOR-megkotes pont azt tiltana meg, ami a helyes
-- allapot.
--
-- A `storageKey` NULL tehat nem hiba, hanem az "meg nincs athozva" allapot.
ALTER TABLE "ProductImage" ADD COLUMN "storageKey" TEXT;

-- A MASOLO EZEN A MEZON SZUR (`storageKey IS NULL`), es a mai adaton 3426
-- sorbol valogat. Index nelkul minden futas teljes tablat olvasna.
CREATE INDEX "ProductImage_storageKey_idx" ON "ProductImage"("storageKey");
