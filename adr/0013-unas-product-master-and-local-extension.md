# ADR-013 – UNAS Product Master és helyi Product Extension

## Állapot

Elfogadva – 2026-07-20

## Kontextus

Az Acropora OS az UNAS webshop termékeit használja az operatív beszerzési,
bevételezési és készletfolyamatok alapjaként. A korábbi katalógusmodell a
`Product` több mezőjét helyi master-adatként kezelte, miközben az első UNAS
XLSX-import ugyanezeket a mezőket az UNAS-ból alkalmazta. Ez kétirányú vagy
mezőnként bizonytalan tulajdonláshoz vezetne.

Az UNAS export 38 releváns termékoszlopot tartalmaz. Ezek webshopos törzsadatok,
nem pedig az Acropora beszerzési vagy fizikai készletadatai. Az exportban nem
igazolt külön stabil UNAS product ID, ezért az API-képességet az automatikus
szinkron bekapcsolása előtt ellenőrizni kell.

## Döntés

Az UNAS az UNAS-ban létező termékek Product Master rendszere. Az Acropora OS
egy helyi, read-only terméktükröt tart fenn, és nem írja vissza vagy felül kézi
CRUD művelettel az UNAS tulajdonú mezőket.

Az Acropora saját adatai külön felelősségi körökben maradnak:

- `ProductExtension`: varianthez kapcsolt statikus beszerzési, raktári és belső
  működési beállítások;
- `GoodsReceiptLine`: tényleges beszerzési ár, deviza, árfolyam és történeti
  bekerülési érték;
- `StockMovementLine`: a fizikai készlet immutable főkönyvi tétele;
- UNAS reported stock: időbélyegzett összehasonlítási snapshot, amely nem írhat
  `StockItem` vagy `StockMovement` rekordot.

A készletezhető egység továbbra is a `ProductVariant`. Egyszerű UNAS termékhez
is egy alapértelmezett variant tartozik. A `ProductExtension`,
`GoodsReceiptLine` és `StockMovementLine` ezért variantet hivatkozik.

A külső identitás feloldási sorrendje:

1. igazolt, stabil UNAS product ID az `ExternalReference` rekordban;
2. ennek hiányában egyedi és stabil SKU átmeneti fallbackként;
3. external ID/SKU ellentmondás esetén blokkolás és kézi feloldás.

## Következmények

- A Product API alapértelmezett felülete read-only lesz az UNAS-termékekre.
- Az UNAS mezők szerkesztése csak szinkronizációs szolgáltatáson keresztül
  történhet.
- A helyi termékbeállítások külön extension endpointot és jogosultságot kapnak.
- Az eladási ár nem keverhető a beszerzési árral vagy bekerülési értékkel.
- Az UNAS stock eltérésvizsgálatra használható, de nem készletnyitásra és nem
  automatikus készletkorrekcióra.
- Az UNAS-ból eltűnt termék alapértelmezetten nem törlődik; `missingSince`
  állapotba kerül, és csak igazolt teljes snapshot-policy archiválhatja.
