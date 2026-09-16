/**
 * A KARBANTARTOTT MÉRTÉKEGYSÉG-LISTA KÖZÖS ALAKJA.
 *
 * A fajta azt mondja meg, MIT MÉR az egység -- nem azt, hol választható. A
 * részletes indoklás a séma `UnitOfMeasureKind` fejlécén és a
 * `docs/DECISIONS.md`-ben áll; itt azért ismételjük a MONDATOT, mert a webes és
 * a mobil oldal ezt a fájlt olvassa, a sémát nem.
 */
export const UNIT_OF_MEASURE_KINDS = [
  "QUANTITY",
  "MEASUREMENT",
  "PERFORMANCE",
] as const;

export type UnitOfMeasureKind = (typeof UNIT_OF_MEASURE_KINDS)[number];

/** A fajták magyar neve, egy helyen: a menü és a szűrő ugyanazt mondja. */
export const unitOfMeasureKindLabel: Record<UnitOfMeasureKind, string> = {
  QUANTITY: "Mennyiség",
  MEASUREMENT: "Mérés",
  PERFORMANCE: "Teljesítmény",
};

export interface UnitOfMeasure {
  id: string;
  /** A rövid jel, ahogy a felületen áll: `db`, `óra`, `W`, `mg/l`. */
  code: string;
  /** A teljes név, ami a listában segít választani: „watt", „liter per óra". */
  name: string;
  kind: UnitOfMeasureKind;
  /**
   * A kivezetett egység NEM tűnik el: a választóból esik ki, a MEGLÉVŐ értékek
   * mellett viszont olvasható marad. Ezért jön vissza a listában is, ha a hívó
   * kifejezetten kéri.
   */
  isActive: boolean;
  sortOrder: number;
}

export interface UnitOfMeasureListResponse {
  items: UnitOfMeasure[];
}

/**
 * A TELJESÍTMÉNY-ÉRTÉK ALAKJA, EGY HELYEN -- ÉS A ROSSZ ALAK 500-AT ADNA.
 *
 * === A MÉRT LÁNC ===
 *
 * A tárolt típus `decimal(19,6)`, a Prisma pedig `Decimal`-t épít a beküldött
 * szövegből. Mérve 2026-09-16, a valódi `Prisma.Decimal`-on:
 *
 *     "0,5"   DOBOTT   [DecimalError] Invalid argument: 0,5
 *     "  7 "  DOBOTT   [DecimalError] Invalid argument:   7
 *     "abc"   DOBOTT
 *     "0.5"   0.5
 *     "1e3"   1000     (átmegy, csak épp senki nem ezt írja be)
 *     "-3"    -3       (átmegy, és értelmetlen)
 *
 * A dobott hiba a tárolóból a szolgáltatás `map` függvényének a végéig fut, és
 * ott `throw error` áll: **500 lenne belőle, nem 400**. Pontosan az a lánc,
 * ami a matricakód `null` esetében egyszer már megtörtént.
 *
 * === ÉS A VESSZŐ NEM ELMÉLETI ESET ===
 *
 * A felület magyar, a kezelő `0,5`-öt ír. A tizedesvessző nem hiba a
 * felhasználó részéről, hanem a MI dolgunk átvenni -- ezért nem elutasítjuk,
 * hanem átalakítjuk.
 *
 * === MIT ENGED ÁT, ÉS MIT NEM ===
 *
 * Üres szöveg -> `null`: nincs érték. A negatív és az exponenciális alak
 * elbukik: egy „-3 W" nem adat, az `1e3` pedig nem az, amit valaki beírni
 * akart. A hat tizedesjegy a tárolt pontosság, nem önkényes szám.
 */
const PERFORMANCE_VALUE_PATTERN = /^\d{1,13}(?:\.\d{1,6})?$/;

export function normalizePerformanceValue(raw: string): string | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!PERFORMANCE_VALUE_PATTERN.test(trimmed)) return null;
  /**
   * A VEZETŐ NULLÁKAT LEVÁGJUK, a tizedeseket NEM.
   *
   * A `007` és a `7` ugyanaz a szám, és két alakban tárolva két különböző
   * szövegként jönne vissza a listákba. A `7.50` viszont MARAD: a kiírt
   * pontosság a mérés pontossága, és azt nem a mi dolgunk elvenni.
   */
  return trimmed.replace(/^0+(?=\d)/, "");
}

/**
 * MI A BAJ A BEÍRT ÉRTÉKKEL, VAGY `null`.
 *
 * KÜLÖN FÜGGVÉNY A NORMALIZÁLÁS MELLETT, mert a kettő KÉT kérdés: a
 * normalizálás üres szövegre és rossz alakra egyaránt `null`-t ad, a felület
 * viszont mást mond a kettőre. Egy „hibás alak" üzenet egy üres mezőre
 * értelmetlen, egy néma elnyelés egy elgépelt számra pedig veszélyes.
 */
export function performanceValueProblem(
  raw: string,
): "empty" | "malformed" | null {
  if (raw.trim() === "") return "empty";
  return normalizePerformanceValue(raw) === null ? "malformed" : null;
}
