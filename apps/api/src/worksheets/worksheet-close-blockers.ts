import {
  worksheetNumberIssue,
  type WorksheetNumberIssue,
} from "./worksheet-number.js";

/**
 * MI AKADÁLYOZZA A MUNKALAP LEZÁRÁSÁT, EGY HELYEN FELSOROLVA.
 *
 * MIÉRT KÜLÖN FÜGGVÉNY, ÉS NEM EGYMÁS UTÁNI `if`-ek a tranzakcióban: a
 * lezárás az a pont, ahol a feltételek ÖSSZEGYŰLNEK, és a lista NŐNI FOG. Ma
 * három tétel áll benne (állapot, tétel, ár), és tudjuk, hogy jön a negyedik:
 * hibajegy nélküli lap nem zárható le és nem írható alá (Balázs, 2026-09-02).
 *
 * Egy beágyazott `if` mellett minden új feltétel a tranzakció közepét írná át.
 * Így egy sor.
 *
 * ÉS AMIÉRT AZ EGÉSZ LISTA DRÁGA, nem csak a lap: a lánc
 * hibajegy → munkalap → teljesítési igazolás → számla úgy áll, hogy ha
 * bármelyik eleme hiányzik, a végén NINCS SZÁMLA. A lezárási feltételek nem a
 * dokumentum szigorúságáról szólnak, hanem arról, hogy a lánc kifizetéssel
 * érjen véget.
 *
 * TISZTA FÜGGVÉNY: a hívó adja be, amit lekérdezett. Így a szabály mérhető
 * anélkül, hogy adatbázis kellene hozzá, és a tranzakció csak azt csinálja,
 * amihez tranzakció kell.
 */
export type WorksheetCloseBlocker =
  "NOT_DRAFT" | "NO_LINES" | "LINE_PRICE_MISSING" | WorksheetNumberIssue;

export interface WorksheetCloseState {
  /** A lap MAI verziójának állapota. */
  status: string;
  /** Hány tétel van a verzión. */
  lineCount: number;
  /**
   * Hány tételen hiányzik az ár.
   *
   * Az ár azért hiányozhat, mert a szerelő a helyszínen azt rögzíti, mit
   * csinált és mennyit; az árat az iroda adja meg. A hiány tehát MEGENGEDETT
   * állapot, csak nem VÉGSŐ - itt derül ki, ha valaki elfelejtette kitölteni.
   */
  linesWithoutPrice: number;
  /** A vevő munkalap-rövidítése, a lapszámhoz. */
  partnerCode: string | null | undefined;
  /** Az alegység kódja, a lapszámhoz. */
  departmentCode: string | null | undefined;
  /** Van-e már száma a lapnak; ha igen, a szám feltételeit nem kell újra nézni. */
  hasNumber: boolean;
}

/**
 * Az ELSŐ akadály, vagy `null`, ha nincs.
 *
 * A sorrend nem közömbös: az általánosabb feltétel áll elöl, mert egy nem
 * piszkozat lapon az ár hiánya sem érdekes. A hívó egy okot mutat, nem
 * listát - az első akadály az, amit a felhasználónak meg kell oldania.
 */
export function worksheetCloseBlocker(
  state: WorksheetCloseState,
): WorksheetCloseBlocker | null {
  if (state.status !== "DRAFT") return "NOT_DRAFT";
  if (state.lineCount === 0) return "NO_LINES";
  if (state.linesWithoutPrice > 0) return "LINE_PRICE_MISSING";

  // A SZÁM FELTÉTELEI CSAK AKKOR, HA MÉG NINCS SZÁMA. Egy már megszámozott
  // lap újralezárásánál a rövidítés hiánya nem akadály: a szám megvan, és
  // visszamenőleg nem is változik.
  if (!state.hasNumber) {
    const issue = worksheetNumberIssue({
      partnerCode: state.partnerCode,
      departmentCode: state.departmentCode,
    });
    if (issue) return issue;
  }

  return null;
}
