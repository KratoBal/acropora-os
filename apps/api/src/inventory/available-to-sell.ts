import { Prisma } from "@acropora/database";

/**
 * A webshopnak jelenthető készlet: EGY képlet, EGY helyen.
 *
 * A mérés (2026-08-27, `MERES-inventory-os-oldal-2026-08-27.md`) szerint ez a
 * képlet a forrásban NÉGY helyen állt külön leírva: az UNAS-kiküldésben, a POS
 * keresőjében, a készlet-egyeztetés célértékénél és a beszerzési számla
 * foglalás utáni cél-`onHand` értékénél. Közös függvény nem volt.
 *
 * Ez a modul azért létezik, mert a Medusa-vetítés lett volna az ÖTÖDIK
 * másolat. Négy másolat nem attól rossz, hogy négy, hanem attól, hogy **ha az
 * egyik elmozdul, semmi nem jelzi**: mind a négy tovább fordul, tovább fut, és
 * a szétcsúszás csak a boltban látszik meg, hetekkel később.
 *
 * A brief 13. pontja pontosan ezt tiltja: „Ne hozz létre két majdnem azonos,
 * később szétcsúszó készletképletet."
 *
 * HÁLÓZAT NÉLKÜL MÉRHETŐ, és ez nem formaság: a brief 4. pontja külön kéri,
 * hogy a számítás ne szóródjon szét parancssori és HTTP kódba. Egy szabály,
 * amit csak éles hívással lehet megnézni, előbb-utóbb méretlen marad.
 */

/**
 * A készletsor két mezője, amit a képlet használ.
 *
 * A `reserved` azért `null`- és `undefined`-tűrő, mert a négy hívó hely
 * HÁROMFÉLE alakban adta: az UNAS-út kötelező mezőként, a POS és az egyeztetés
 * `?? 0` írásmóddal (ott a Prisma `select` `undefined`-ot ad, nem `null`-t), a
 * beszerzési oldal pedig egy KISZÁMÍTOTT foglalás-értékkel. A hiányzó érték
 * mindhárom helyen ugyanazt jelentette: nulla. A viselkedést tehát nem
 * változtatom meg azzal, hogy összevonom őket.
 */
export interface StockRowForSale {
  onHand: Prisma.Decimal;
  reserved?: Prisma.Decimal | null;
}

/**
 * `onHand - reserved`, ELŐJEL NÉLKÜL.
 *
 * A negatív érték itt szándékosan NEM vágódik nullára. A vágás a CÉLRENDSZER
 * dolga, és rendszerenként más: az UNAS ma negatívan is megkapja (Balázs
 * döntése, 2026-08-27 13:06: a kijelzés ki van kapcsolva, a leltárig ez a
 * szándékolt állapot), a Medusa admin validátora viszont `min(0)` megkötést ír
 * elő, tehát ott a vágás KÉNYSZER.
 *
 * Ha a vágás ide kerülne, elvenné az UNAS-úttól azt a viselkedést, ami ma
 * üzleti döntésen áll - és a szabály nem lenne látható azon a helyen, ahol
 * érvényes.
 */
export function availableToSell(stock: StockRowForSale): Prisma.Decimal {
  return stock.onHand.minus(stock.reserved ?? new Prisma.Decimal(0));
}
