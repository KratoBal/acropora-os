# ADR-005 – UI-komponensek központi csomagból

## Állapot

Elfogadva – 2026-07-19

## Kontextus

Az Acropora OS több alkalmazást és sok üzleti modult fog tartalmazni. Ha az alkalmazások saját gombokat, mezőket, kártyákat és navigációs elemeket építenek, a vizuális nyelv, az akadálymentesség és a viselkedés rövid idő alatt széttartóvá válik.

## Döntés

Az újrafelhasználható UI-komponensek kizárólag a `packages/ui` csomagban hozhatók létre, és az alkalmazások annak publikus exportjaiból használhatják őket.

Az alkalmazásréteg felelős:

- az üzleti adatokért és szabályokért;
- az útvonalkezelésért;
- a jogosultságokért;
- a UI-komponensek oldal- és funkciószintű összeállításáért.

A `packages/ui` felelős:

- a vizuális primitívekért és állapotaikért;
- az akadálymentes alapviselkedésért;
- a design system következetes megvalósításáért;
- a frameworkfüggetlen, üzleti logikát nem tartalmazó API-kért.

## Következmények

- A megjelenés és az interakciók egységesen fejleszthetők.
- A komponensmódosítások több alkalmazásra is hathatnak, ezért publikus API-juk változtatása körültekintést igényel.
- Az alkalmazások továbbra is használhatnak elrendezési segédosztályokat és üzleti kompozíciós komponenseket, de nem másolhatják a közös UI-primitíveket.
- Új primitív bevezetésekor a design system dokumentációját is frissíteni kell.
