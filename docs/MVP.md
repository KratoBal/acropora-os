# MVP – elfogadási feltételek

## 1. UNAS kapcsolat

- API-kulcs biztonságos tárolása.
- Termékek lekérése és importálása.
- SKU és UNAS-azonosító összerendelése.
- Egy teszttermék készletének lekérése.
- `in` és `out` próbamozgás naplózása.

## 2. Bevételezés

- Piszkozat létrehozása.
- Beszállító, bizonylatszám, dátum és raktár megadása.
- Legalább 100 tétel kezelése egy bizonylaton.
- SKU/EAN alapú termékkeresés.
- Duplikált tételek összevonása.
- Véglegesítés után visszamenőleges, közvetlen szerkesztés tiltása.
- Tételenként látható UNAS-szinkronállapot.

## 3. Készletnapló

- Minden változásnak típusa, mennyisége, felhasználója, időpontja és hivatkozása van.
- Termékenként visszakereshető teljes történet.
- Negatív eladható készlet alapértelmezetten tiltott.

## 4. Számlázási próba

- UNAS számlázható rendelés felismerése.
- Számlázz.hu kérés előállítása.
- Ugyanaz a rendelés nem számlázható kétszer.
- Számlaszám és URL visszaírása az UNAS-ba.
- Külső hiba esetén ember számára érthető hibaüzenet.
