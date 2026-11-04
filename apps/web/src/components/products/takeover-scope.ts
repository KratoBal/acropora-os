/**
 * MI TÖRTÉNIK A TERMÉKKEL AZ ÁTVÉTEL UTÁN (T4.1-D1, kártya 33f177b4; polip
 * adatgazda-táblázata, 2026-11-03, acrobot döntése: a dokumentumot igazítjuk a
 * kódhoz, nem fordítva).
 *
 * A KÓD: a termék-szinkron az átvett terméket a ciklus ELEJÉN hagyja ki
 * (`unas-product-sync.repository.ts`, a `skippedProductIds` őrző), és minden
 * további írása (változat, ár-tükör, szállítási jelző, SEO-sor, kép, kategória,
 * kapcsolat) utána jön. Az átvétel tehát nem a nevet és a leírást veszi át,
 * hanem az EGÉSZ terméket kiveszi a szinkronból. Ami ezek közül az OS-ben nem
 * szerkeszthető, az az utolsó UNAS-értéken befagy.
 *
 * EGY LISTA, KÉT OLVASÓ: az átvételi megerősítés és az átvett termék kártyája
 * innen rajzol, a `docs/PRODUCT-CATALOG.md` ugyanezeket a szavakat sorolja, és a
 * `takeover-scope.test.ts` a kettő egyezését méri.
 */

/** Az átvétel után az OS termékszerkesztőjében szerkeszthető (`UpdateProductDto`). */
export const TAKEOVER_EDITABLE = [
  "név",
  "rövid leírás",
  "terméktípus",
  "márka",
  "kategória",
  "vásárolható a webshopban jelző",
] as const;

/** Az átvétel után az utolsó UNAS-értéken áll, és ma nincs rá OS-oldali szerkesztő. */
export const TAKEOVER_FROZEN = [
  "hosszú leírás",
  "keresőoptimalizálási mezők (SEO cím, leírás, kulcsszó)",
  "képek és alt-szövegek",
  "hasonló és kiegészítő termékek",
  "gyártói cikkszám",
  "mértékegység és másodlagos egység",
  "ÁFA-kulcs",
  "a UNAS-ból jövő szállítási jelzők",
] as const;

/** Az átvétel nem érinti: ezeknek ma sem a szinkron a gazdája. */
export const TAKEOVER_UNTOUCHED = [
  "készlet",
  "vonalkódok",
  "beszállító és raktárhely",
  "a kézzel állított szállítási jelzők",
] as const;

/** Az ár külön mondat, mert nem befagy, hanem egyszer átmásolódik (`takeover-price.ts`). */
export const TAKEOVER_PRICE_NOTE =
  "Az eladási ár az átvétel napján a UNAS listaárából indul, ha a saját ár még üres. Ha akció fut, az az átvétellel megszűnik.";
