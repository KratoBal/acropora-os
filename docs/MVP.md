# MVP – elfogadási feltételek

> Ez a dokumentum a projekt legkorábbi, eredeti MVP-célkitűzését rögzíti.
> A fejlesztés azóta részben más sorrendben és más modulhatárokkal haladt
> (pl. Leltár/Raktár a klasszikus bevételezés helyett, Vevők/NAV modul
> a Számlázz.hu-integráció előtt) – az aktuális, ténylegesen elkészült
> funkciókért lásd [CURRENT_STATUS.md](./CURRENT_STATUS.md). Alább az
> eredeti kritériumok látszólagos állapota:

## 1. UNAS kapcsolat — elkészült

- API-kulcs biztonságos tárolása. ✅ (M2.2 UNAS Connection Settings)
- Termékek lekérése és importálása. ✅ (M2.1 UNAS Product Synchronization)
- SKU és UNAS-azonosító összerendelése. ✅
- Egy teszttermék készletének lekérése. ✅
- `in` és `out` próbamozgás naplózása. ✅ (Leltár/Raktár modul)

## 2. Bevételezés — nincs elkészítve ebben a formában

- Piszkozat létrehozása.
- Beszállító, bizonylatszám, dátum és raktár megadása.
- Legalább 100 tétel kezelése egy bizonylaton.
- SKU/EAN alapú termékkeresés.
- Duplikált tételek összevonása.
- Véglegesítés után visszamenőleges, közvetlen szerkesztés tiltása.
- Tételenként látható UNAS-szinkronállapot.

Ehelyett a Leltár (`/keszlet-egyeztetes`) és Raktár (`/raktar`) modul
készült el, amely leltárszámláláson és `StockItem` baseline-on alapul, nem
klasszikus beszállítói bevételezési piszkozaton. Dedikált Purchasing/
GoodsReceipt modul (beszállító, bizonylatszám, tételes bevételezés) még
nem indult el.

## 3. Készletnapló — részben

- Minden változásnak típusa, mennyisége, felhasználója, időpontja és hivatkozása van.
- Termékenként visszakereshető teljes történet.
- Negatív eladható készlet alapértelmezetten tiltott.

## 4. Számlázási próba — nincs elkészítve

- UNAS számlázható rendelés felismerése.
- Számlázz.hu kérés előállítása.
- Ugyanaz a rendelés nem számlázható kétszer.
- Számlaszám és URL visszaírása az UNAS-ba.
- Külső hiba esetén ember számára érthető hibaüzenet.

A Számlázz.hu-integráció még nem indult el. Ehelyett a NAV Online Számla
`queryTaxpayer` végpontja készült el, ami más célt szolgál: adószám alapján
cégadatot (nem számlát) kérdez le új Vevő felvitelekor (lásd
[CURRENT_STATUS.md](./CURRENT_STATUS.md)).
