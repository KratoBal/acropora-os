/**
 * MIKOR KELETKEZIK UJ AR-TORTENET SOR.
 *
 * === A SZABALY ===
 *
 * Az INDULASKOR minden termek kap egy KEZDO sort, meg akkor is, ha az ara azota
 * sem mozdult. Enelkul egy harminc napig valtozatlan arnal nincs mihez merni --
 * es epp az a leggyakoribb eset.
 *
 * Utana csak a VALTOZAS keletkeztet sort. Ha az ar-kep betuere ugyanaz, nem
 * irunk uj sort: a tortenetnek az elteres a tartalma, nem a szinkron gyakorisaga.
 *
 * === MIERT SZTRING-OSSZEVETES, ES NEM SZAM ===
 *
 * A `Decimal` ertekek objektumkent jonnek az adatbazisbol, es a `===` rajtuk
 * MINDIG hamis -- ket egyforma ar ket kulonbozo peldany. Egy ilyen
 * osszehasonlitas nem hibazna, csak MINDEN szinkronon uj sort irna, es a
 * tortenet napi zajja valna. Ezert normalizalunk sztringre, es a `null` a
 * `null`-lal egyenlo.
 *
 * === ES AMIT A NULL JELENT ===
 *
 * A hianyzo ar NEM nulla forint: azt jelenti, hogy a forras nem adott erteket.
 * A ketto kulonbozo allitas, es a tortenetben is annak kell latszania -- ezert
 * marad `null`, es ezert szamit VALTOZASNAK, ha egy ertek megjelenik vagy
 * eltunik.
 */

/** Az ar-kep, ahogy a tortenet tarolja. */
export type ArKep = {
  currency: string | null;
  netPrice: unknown;
  grossPrice: unknown;
  saleNetPrice: unknown;
  saleGrossPrice: unknown;
};

/**
 * Egy ar-mezo osszehasonlithato alakja. A `Decimal` es a `number` is sztringge
 * valik; a `null` es az `undefined` ugyanaz az allitas (nincs ertek).
 */
function alak(ertek: unknown): string | null {
  if (ertek === null || ertek === undefined) return null;
  if (typeof ertek === "string") return ertek.trim() === "" ? null : ertek;
  if (typeof ertek === "number") return String(ertek);
  if (typeof ertek === "object" && "toString" in (ertek as object)) {
    return String(ertek);
  }
  return String(ertek);
}

export function arKepAlakja(kep: ArKep): string {
  return [
    alak(kep.currency),
    alak(kep.netPrice),
    alak(kep.grossPrice),
    alak(kep.saleNetPrice),
    alak(kep.saleGrossPrice),
  ]
    .map((ertek) => (ertek === null ? "\u0000" : ertek))
    .join("|");
}

/**
 * Kell-e uj sor. `elozo === null` azt jelenti, hogy meg egy sor sincs a
 * termekhez -- olyankor MINDIG kell, ez a kezdo sor esete.
 */
export function kellUjArSor(elozo: ArKep | null, mostani: ArKep): boolean {
  if (elozo === null) return true;
  return arKepAlakja(elozo) !== arKepAlakja(mostani);
}
