# ADR-008 – Product és ProductVariant szétválasztása

## Állapot

Elfogadva – 2026-07-19

## Kontextus

Egy termék közös kereskedelmi identitása több méretben vagy kiszerelésben jelenhet meg. A készlet, barcode, beszállítói megfeleltetés és rendelési sor azonban mindig egy konkrét értékesíthető egységre vonatkozik.

## Döntés

A `Product` a közös leírás, típus, brand és kategória aggregate rootja. A `ProductVariant` az egyedi SKU-val rendelkező, értékesíthető és készletezhető egység. Barcode, supplier product, ár és készlet kizárólag varianthez kapcsolódik.

## Következmények

- A variációk nem duplikálják a közös termékadatot.
- Az SKU globálisan egyedi és stabil üzleti azonosító.
- Egyszerű termékhez is legalább egy variant szükséges.
- A részletes variant attribútumrendszer későbbi bővítés.
