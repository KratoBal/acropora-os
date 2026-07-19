# Márkaimport asszisztens

Az `/admin/brands/import-assistant` oldal egy kiválasztott, perzisztált UNAS batch forrásmárkáit egyezteti a Brand master data-val. Nem olvas helyi exportfájlt, nem futtatja újra a resolver motort, és sem review döntést, sem import Apply műveletet nem végez.

## Besorolások

- `EXACT_CANONICAL_MATCH`: egy aktív kanonikus normalizált név egyezik.
- `ALIAS_MATCH`: egy aktív BrandAlias egyezik.
- `EXTERNAL_MAPPING_MATCH`: meglévő UNAS ExternalReference egyezik.
- `MISSING_BRAND`: nincs biztonságos cél.
- `AMBIGUOUS`: több aktív, névelemek alapján lehetséges cél van.
- `ARCHIVED_MATCH`: az egyetlen közvetlen egyezés archivált.
- `CONFLICT`: a közvetlen identitások vagy mappingek eltérő Brand tulajdonában vannak.

A `&`, írásjelek, kis-/nagybetűk és ékezetek normalizálása a Brand Management szabályait használja. Az azonos normalizált forrásértékek egy feladatba esnek; az előfordulásszám és legfeljebb három termékpélda megmarad.

## Munkafolyamatok és védelem

A `products.view` jogosultság olvasást, a `products.manage` módosítást enged. Egy hiányzó forrásból létrehozható szerkeszthető nevű Brand és — eltérő névnél — UNAS alias. Létező aktív Brand csak választómezőből célozható. Külső mapping kizárólag igazolt stabil UNAS azonosítóval készülhet; megjelenítési névből az asszisztens nem gyárt external ID-t.

A bulk művelet csak explicit, az aktuális oldalon kijelölt `MISSING_BRAND` sorokat fogad, legfeljebb 200-at. A `CREATE <count> BRANDS` szöveges megerősítés után a backend stabil sorazonosítók alapján újraelemzi a batch aktuális állapotát. Minden létrehozás külön Serializable tranzakció: a Brand és saját DomainEventje atomi, miközben egy ütköző sor nem teszi használhatatlanná a többi eredményt. A válasz soronként `CREATED`, `ALREADY_RESOLVED`, `SKIPPED`, `CONFLICT` vagy `FAILED` státuszt ad. Az adatbázis unique constraintjei és az újraelemzés teszik az ismételt vagy párhuzamos kérést idempotenssé. A kérés végén strukturált AuditLog rögzíti a felhasználót, batch-et és az összesített darabszámokat.

Archivált találat nem áll vissza automatikusan; a Brand adatlapján külön, jogosult művelet szükséges. Ambiguous és conflict sor nem bulk-feldolgozható.

## Review integráció és első import runbook

1. Nyisd meg a VALIDATED batch review oldalát, majd a „Márka master data előkészítése” műveletet.
2. Vizsgáld át a missing, ambiguous, archived és conflict sorokat.
3. Egyenként hozz létre márkát vagy rendelj alias célmárkát; bulkban csak a ténylegesen ellenőrzött sorokat jelöld ki.
4. Térj vissza a megőrzött `returnTo` URL-re, frissítsd a review-t, és ott külön ellenőrizd a backend javaslatot.
5. A Brand létrehozása vagy aliasolása nem fogad el review sort, nem változtat `PENDING/ACCEPTED/NO_BRAND` döntést, és nem hagy jóvá vagy alkalmaz batch-et.

Az oldal URL-ben tartja a `batchId`, `classification`, `search`, `page`, `pageSize` és `returnTo` állapotot. Exportfájl és személyes adat nem kerülhet Gitbe.
