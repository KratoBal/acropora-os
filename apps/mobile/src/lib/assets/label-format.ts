/**
 * A QR-CÍMKE GEOMETRIÁJA: EGY BEMENET, MINDEN MÁS LEVEZETÉS.
 *
 * A szalag 24 mm SZÉLES (Balázs, 2026-08-26), és folytonos. Ebből két dolog
 * következik, és a mai 30x30 mm-es négyzet mindkettőt elrontja: a magasság
 * kötött (a szalag keresztirányban ennyi), a HOSSZ viszont szabad.
 *
 * EZÉRT NINCS TÖBB KÜLÖN "QR-MÉRET" KONSTANS. A lapméret a bemenet, a kód
 * mérete abból SZÁMOLÓDIK -- a belső margó és a feliratsáv levonásával. Amíg két
 * szabad szám állt egymás mellett (`LABEL_SIZE_MM` és `LABEL_QR_SIZE_MM`),
 * előbb-utóbb valaki az egyiket írta volna át, és a kód kilógott volna a
 * szalagról úgy, hogy semmi nem jelzi: a PDF elkészül, a nyomtatás lefut, és
 * csak a beolvasás bukik el a helyszínen.
 *
 * AMIT NEM TUDUNK, ÉS NEM IS TALÁLGATUNK: a ténylegesen NYOMTATHATÓ sáv
 * magassága. A 24 mm a szalag fizikai szélessége; a nyomtatófej ennél
 * keskenyebb sávot ír. A hivatalos Brother értéket nem sikerült forrásból
 * igazolni (a dokumentációs tartomány nincs a letöltési engedélylistán), ezért
 * itt a MÉRT adat áll: a szalag szélessége. Az első nyomtatás mutatja meg,
 * mennyi vész el a széleken -- és azt is, hogy a nyomtató alkalmazása levág
 * vagy arányosan kicsinyít. Addig egyik állítás sem tekinthető ismertnek.
 */

/**
 * BEMENET 1: a lap MAGASSÁGA, a szalag keresztirányában, milliméterben.
 *
 * Ez a szalag szélessége. Ha az első nyomtatás azt mutatja, hogy a fej ennél
 * keskenyebb sávot ír ÉS levág (nem kicsinyít), ez az egyetlen szám áll át, és
 * a QR mérete, a modul-méret meg a feliratsáv magától követi.
 */
export const LABEL_BAND_MM = 24;

/**
 * BEMENET 2: a lap HOSSZA, a szalag irányában, milliméterben.
 *
 * A szalag folytonos, tehát ezt nem a nyomtató korlátozza, hanem az, hogy mi
 * fér ki olvashatóan. A mai érték az eszközszám hosszából jön: a szám 25
 * karakter (`ESZK-ÉÉÉÉHHNN-ÓÓPPMM-XXXX`, lásd `apps/api/src/common/
 * code-generator.util.ts`), és ez a hossz engedi kiírni egy sorban, olvasható
 * betűmérettel. Ha rövidebb címke kell, a betűméret vagy a kiírt szám rövidül
 * -- ez üzleti döntés, nem geometria.
 */
export const LABEL_LENGTH_MM = 72;

/** BEMENET 3: belső margó minden oldalon. */
export const LABEL_PADDING_MM = 1.5;

/** BEMENET 4: rés a kód és a feliratsáv között. */
export const LABEL_GAP_MM = 1.5;

/** BEMENET 5: az eszközszám betűmérete. Ez a címke azonosító sora. */
export const LABEL_NUMBER_FONT_MM = 3;

/** BEMENET 6: a név betűmérete. Ez elfér kevesebbel, mert kiegészítő adat. */
export const LABEL_NAME_FONT_MM = 2.2;

/**
 * A SZIMBÓLUM SZÉLESSÉGE MODULBAN, a csendes zónával együtt.
 *
 * NEM a mi választásunk: a szerver `createAssetQrSvg` fix Version 5 szimbólumot
 * ad (37 x 37 modul), és 4 modulnyi csendes zónát rajzol köré, tehát a
 * `viewBox` 45 egység széles. A mi mm-ünk erre a 45-re oszlik.
 *
 * Ez a szám MÁSHOL él (`apps/api/src/service-assets/qr-svg.ts`), ezért a
 * spec-fájl visszaolvassa onnan. Ha a szerver verziót vált, a modul-méret
 * megváltozik anélkül, hogy itt bármi módosulna -- az az eset legyen piros,
 * ne meglepetés a nyomtatónál.
 */
export const QR_MODULES_ACROSS = 45;

/**
 * A MODUL ALSÓ HATÁRA, milliméterben. IRODALMI ÉRTÉK, NEM A MI MÉRÉSÜNK.
 *
 * Telefonkamerás beolvasásnál a szokásos alsó határ 0,3 mm körül van. Ez nem
 * bizonyíték, hanem küszöb: ami ez alá esik, azt nem érdemes kinyomtatni sem.
 * Az elfogadás feltétele változatlanul az ELSŐ próbálkozásra sikeres beolvasás.
 */
export const QR_MIN_MODULE_MM = 0.3;

export type LabelLayout = {
  /** A lap hossza (a szalag irányában), mm. */
  pageWidthMm: number;
  /** A lap magassága (a szalag keresztirányában), mm. */
  pageHeightMm: number;
  /** A QR rajz oldalhossza, mm. A csendes zóna EBBEN VAN BENNE. */
  qrSizeMm: number;
  /** A feliratsáv szélessége a kód mellett, mm. */
  textWidthMm: number;
  /** Egy QR-modul oldalhossza, mm. Ez az egyetlen szám, ami a beolvashatóságról szól. */
  moduleMm: number;
};

/**
 * A LEVEZETÉS. Fekvő elrendezés: a kód megkapja a teljes magasságot, a felirat
 * a mellette maradó sávot.
 *
 * Ez a fekvő alaknak az a nyeresége, amit a négyzet nem engedett: álló
 * elrendezésben (felirat a kód ALATT) a szövegsáv a magasságból venne el, tehát
 * pontosan abból, amiből a modul-méret származik.
 */
export function labelLayout(): LabelLayout {
  const qrSizeMm = LABEL_BAND_MM - 2 * LABEL_PADDING_MM;
  const textWidthMm =
    LABEL_LENGTH_MM - 2 * LABEL_PADDING_MM - qrSizeMm - LABEL_GAP_MM;

  return {
    pageWidthMm: LABEL_LENGTH_MM,
    pageHeightMm: LABEL_BAND_MM,
    qrSizeMm,
    textWidthMm,
    moduleMm: qrSizeMm / QR_MODULES_ACROSS,
  };
}

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
 * Enélkül a lap Letter méretű lesz (az `expo-print` iOS oldalán a
 * `PrintOptions.toPageSize()` a `kLetterPaperSize = 612 x 792` pontból indul, és
 * csak a hívás `width`/`height` értékét veszi figyelembe; a `@page` CSS-t ez az
 * út nem olvassa) -- nem hibaüzenettel, hanem egy használhatatlan PDF-fel, ami
 * első ránézésre rendben van.
 */
export function labelPageSize(): { width: number; height: number } {
  const layout = labelLayout();
  return {
    width: mmToPoints(layout.pageWidthMm),
    height: mmToPoints(layout.pageHeightMm),
  };
}
