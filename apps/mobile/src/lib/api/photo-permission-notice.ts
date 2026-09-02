/**
 * MIT MOND A FELÜLET, HA A JOGOSULTSÁGOT MEGTAGADTÁK.
 *
 * KÜLÖN FÜGGVÉNY, MERT A KÉT ÜZENET NEM EGYFORMA SÚLYÚ, és a különbség
 * könnyen elveszne egy közös "nincs engedély" mondatban.
 *
 * A KAMERA AZ ELSŐDLEGES ÚT: a szerelő a helyszínen MOST készít képet. Ha ezt
 * megtagadják, a felület nem érhet véget egy hibaüzenettel - meg kell
 * mondania, hol állítható, ÉS hogy a galéria közben járható marad. Enélkül a
 * szerelő azt hiszi, egyáltalán nem tud képet feltölteni.
 *
 * A GALÉRIA A MÁSODIK ÚT: ha AZT tagadják meg, nincs mit felkínálni helyette -
 * a kamerát ilyenkor felajánlani félrevezető volna, mert épp az lehet, hogy a
 * szerelő szándékosan a régi képet keresi.
 *
 * Tiszta függvény, hogy a szöveg mérhető legyen anélkül, hogy telefont vagy
 * jogosultsági párbeszédet kellene hozzá indítani.
 */
export type PhotoPermissionKind = "camera" | "library";

export function photoPermissionDeniedNotice(kind: PhotoPermissionKind): string {
  if (kind === "camera") {
    return "A fényképezéshez kamera-hozzáférés kell, ami a telefon beállításaiban adható meg. Addig a galériából is feltölthetsz képet.";
  }
  return "A fényképek eléréséhez engedély kell. A telefon beállításaiban adható meg.";
}
