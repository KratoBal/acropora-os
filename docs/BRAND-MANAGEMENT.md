# Brand master-data kezelés

Az importból érkező forrásmárkák kézi előkészítését a [Márkaimport asszisztens](./BRAND-IMPORT-ASSISTANT.md) végzi, ugyanazzal a normalizálással és adatbázis-ütközésvédelemmel.

A Brand az Acropora OS kanonikus gyártói/márkaidentitása. A `/admin/brands` lista `products.view`, a létrehozás, módosítás, alias-kezelés, archiválás és visszaállítás `products.manage` jogosultságot igényel.

## Identitás és normalizálás

A `normalizedName` Unicode NFKD normalizálást, diakritika- és írásjel-eltávolítást, kisbetűsítést és whitespace-egységesítést használ. Egy normalizált kanonikus név csak egyszer létezhet; a rendszer nem egyesít automatikusan rekordokat. A slug ugyanebből a determinisztikus kulcsból készül.

Az alias forráshoz kötött (`MANUAL`, `UNAS` vagy későbbi provider), és egy forráson belül egy normalizált alias csak egy Brandhez tartozhat. A kanonikus név felesleges aliasként nem menthető. A stabil UNAS external ID az általános `ExternalReference` modellben, `UNAS`/`BRAND` kulccsal él.

## Archiválás és konkurencia

Az archiválás soft archive: a Product-kapcsolatok, aliasok, external reference-ek és importelőzmények megmaradnak. Archivált Brand új automatikus vagy review-hozzárendelés célja nem lehet. Visszaállításkor az adatbázis újra érvényesíti az egyediséget.

A szerkesztés `updatedAt` optimista concurrency tokent használ; elavult mentés 409 konfliktust ad. Az alias egyediséget adatbázis-constraint és tranzakció védi. A mutáció és a hozzá tartozó `brand.*` DomainEvent ugyanabban a tranzakcióban készül.

## UNAS review munkafolyamat

A resolver determinisztikus szótára továbbra is bizonyíték és konfiguráció. A tényleges Product asszociáció célja azonban csak aktív, perzisztált Brand lehet, kanonikus vagy alias egyezéssel. A review felület jelzi az aktív, archivált és hiányzó master adatot. Hiányzó márkánál előtöltött Brand-létrehozás nyitható meg, majd a rendszer visszatér a review-hoz.

A létrehozás szándékosan nem fogadja el automatikusan a review sort: az embernek frissítés után explicit `ACCEPT` döntést kell adnia. Ez megőrzi az auditálható döntési határt.

## Valós batch előkészítési runbook

1. Nyisd meg a Brand listát, és egyenként hozd létre vagy aliasold a felülvizsgált forrásneveket.
2. Ne használj automatikus „create all” műveletet.
3. Frissítsd a `cmrrx41c2000079wo92lr9clz` review oldalát, és ellenőrizd a master-data jelzéseket.
4. Minden review döntés maradjon explicit; approval és Apply külön operációs engedélyhez kötött.
