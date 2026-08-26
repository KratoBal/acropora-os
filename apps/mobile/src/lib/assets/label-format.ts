/**
 * A QR-CÍMKE MÉRETE, EGYETLEN HELYEN.
 *
 * A mért hiba (2026-08-26): a címke stílusa `@page { size: 30mm 30mm }`-et kért,
 * a PDF mégis teljes lapra készült, és a Brother alkalmazás hibát dobott rá.
 *
 * Az ok az `expo-print` iOS forrásában áll, nem feltevés: a `PrintOptions`
 * `toPageSize()` metódusa a `kLetterPaperSize = 612 x 792` pontból indul, és CSAK
 * akkor írja felül, ha a hívás `width`/`height` értéket ad. A mi hívásunk nem
 * adott, tehát a lap 612 x 792 pont, vagyis 215,9 x 279,4 mm lett -- egy apró
 * címkével a sarkában. (A forrás kommentje A4-et mond, a konstans Letter: a
 * megnevezés és a mért érték itt sem ugyanaz.)
 *
 * A `@page` CSS-t ez az út nem olvassa: a lapméret a Swift oldalról jön, a
 * WebKit nézet ekkora kerettel készül, és a PDF-et abba rajzolja.
 *
 * EZÉRT ÁLL A MÉRET EGYETLEN HELYEN, ebben a modulban. A stílus és a hívás
 * ugyanabból a számból származik; ha két helyen állna, két év múlva két
 * különböző méret lenne belőle, és a különbség csak nyomtatásban derülne ki.
 */

/**
 * A címke oldalhossza milliméterben. NÉGYZET, mert a mai címke az.
 *
 * A szalag szélessége még nincs megmérve (a nyomtatóban lévő szalagot Balázs
 * mondja meg), ezért ez marad a mai érték. A csere EGY SOR, nem átírás.
 */
export const LABEL_SIZE_MM = 30;

/** A QR-kód oldalhossza a címkén belül, a felirat helyét meghagyva. */
export const LABEL_QR_SIZE_MM = 23;

/**
 * Milliméterből PDF-pont. A PDF pont mérete rögzített: 1/72 hüvelyk, tehát a
 * váltószám nem beállítás kérdése.
 */
export function mmToPoints(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * Amit a `Print.printAsync` és a `printToFileAsync` hívásba kell tenni.
 *
 * Enélkül a lap Letter méretű lesz -- nem hibaüzenettel, hanem egy használhatatlan
 * PDF-fel, ami első ránézésre rendben van.
 */
export function labelPageSize(): { width: number; height: number } {
  const side = mmToPoints(LABEL_SIZE_MM);
  return { width: side, height: side };
}
