/**
 * A KEDVENC OLDALAK (Balázs, 2026-10-27, fő csatorna, msg 1564543075383115838):
 * minden menüpont képernyőjén egy csillag gomb "Kedvencekbe" felirattal; amit
 * megjelöl, az az Áttekintés fölötti Kedvencek menübe kerül.
 *
 * A KEDVENC EGY ÚTVONAL, nem jogosultsági azonosító: két menüpont állhat
 * ugyanazon az `entryId`-n (Válogatások és Márkák), az útvonal az, ami a
 * felületen egy menüpontot megkülönböztet. A szerver ezért csak az ALAKJÁT
 * őrzi (belső, lekérdezés nélküli útvonal); hogy ma menüpont-e és látható-e a
 * felhasználónak, azt a web dönti el kirajzoláskor.
 */
export const FAVORITE_LIMITS = {
  /** Egy felhasználó legfeljebb ennyi kedvencet tarthat. */
  maxPerUser: 50,
  /** Az útvonal hossza (az oszlop szélessége is ennyi). */
  maxHrefLength: 200,
} as const;

/** `/`, vagy `/szegmens/szegmens`: betű, szám, kötőjel, pont, alsóvonal, tilde. */
const FAVORITE_HREF_PATTERN =
  /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;

/**
 * Belső, lekérdezés és töredék nélküli útvonal-e. A `//gazda` és a `https://`
 * alak azért esik ki, mert a kedvenc a menü egy oldala, nem tetszőleges cím.
 */
export function isFavoriteHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= FAVORITE_LIMITS.maxHrefLength &&
    FAVORITE_HREF_PATTERN.test(value) &&
    // a `.` és a `..` szegmens nem menüpont, hanem kitérő
    !value.split("/").some((segment) => /^\.+$/.test(segment))
  );
}

/** A felhasználó kedvencei a megjelölés sorrendjében (régebbi elöl). */
export interface FavoriteListResponse {
  items: string[];
}
