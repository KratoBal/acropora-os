import { createHash } from "node:crypto";

/**
 * A TERMEKKEP AZONOSITOJA A MI TAROLONKBAN.
 *
 * NEM a `ProductImage.id`, es ez mert dontes. Mindket UNAS-iro
 * `deleteMany` + `createMany` parossal dolgozik a `source: "UNAS"` sorokon, es
 * az `id` `cuid` -- tehat MINDEN IMPORT UJ AZONOSITOT ad ugyanannak a kepnek.
 * Egy `id`-re epulo tarolo-kulcs eseten minden import utan ARVA fajlok
 * maradnanak a lemezen, es a masolo ujra letoltene mind a 3426 kepet.
 *
 * AZ URL LENYOMATA VISZONT STABIL: ugyanaz a kep ugyanazt a kulcsot kapja, az
 * import ujrairasa utan is. A `ProductImage` sajat egyedi kulcsa is
 * `[productId, url]`, tehat a mi oldalunkon a kep azonossaga MAR igy van
 * definialva.
 *
 * MIERT LENYOMAT ES NEM A FAJLNEV -- ES A SZAM ROSSZABB, MINT AMIT ELSORE
 * HITTEM. Merve a teljes UNAS exporton, a `Filename` mezon:
 *
 *   3426 kep, de csak 1803 KULONBOZO fajlnev
 *   666 termeknel EGY TERMEKEN BELUL ismetlodik a nev
 *   felulirassal 1621 kep veszne el
 *
 * A tarolo kulcsa `products/<productId>/<documentId>` alaku, tehat a
 * termekek KOZOTTI utkozes nem is szamitana (abbol egyetlen egy van, az
 * `ETM-MP052` harom termeknel). Ami szamit, az a TERMEKEN BELULI ismetlodes:
 * egy termek base es alt kepe gyakran UGYANAZT a nevet viseli, es egy
 * nev-alapu kulcs eseten a masodik FELULIRNA az elsot -- csendben, mert a
 * tarolo `put` muvelete nem kerdez.
 *
 * Elsore a termekek KOZOTTI utkozest irtam ide, meres nelkul. Az igaz, de
 * majdnem semmit nem mond (egy eset); a valodi ok a terméken beluli, es az
 * ezerhatszaz kepet erint.
 *
 * A HOSSZ 32 KARAKTER (a sha256 fele). Nem a rovidites a lenyeg, hanem hogy a
 * kulcs egy KONYVTARNEVBE valo, olvashato ertek maradjon; a felezes utan is
 * 128 bit all benne, ami a 3426 kepnel nagysagrendekkel tobb az utkozeshez
 * szuksegesnel.
 */
export function productImageDocumentId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}
