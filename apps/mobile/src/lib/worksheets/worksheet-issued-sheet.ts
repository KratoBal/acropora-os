/*
  RELATIV UT, NEM `@/` ALIAS -- ES EZT A FORDITAS KENYSZERITETTE KI.

  A `tsconfig.test.json` szandekosan NEM oldja fel az aliast (a sajat fejlece
  mondja ki, miert: a `paths` a forditast megjavitana, de a KIBOCSATOTT
  specifikatort nem irja at, tehat a futas hasalna el rajta). Ez a modul a
  teszt-forditasba is bekerul, tehat testver-uton kell hivatkoznia.
*/
import type { ServiceDocumentSummary } from "../documents/document-view";

/**
 * A KIADOTT MUNKALAP KÜLÖNVÁLASZTÁSA A CSATOLMÁNYOKTÓL -- A TELEFONON.
 *
 * A webes oldal ezt 2026-09-18-án megkapta (#858); a telefonon a kiadott lap
 * azóta is a „Csatolmányok" szakaszban áll, és a fejléc SZÁMA is beleszámolja.
 * Vagyis a telefon hármat mond ott, ahol kettő csatolmány van és egy kiadott lap.
 *
 * === AMI A TELEFONON MÁS, MINT A WEBEN ===
 *
 * Ott a szétválasztásnak a LETÖLTÉSHEZ is köze volt. Itt nincs: a telefonon
 * EGYETLEN dokumentumra sincs letöltési út, és a nem megnézhető fájlok sora
 * maga mondja meg, hol nyitható meg. Ezt a mondatot a szétválasztás NEM
 * veszítheti el (acrobot kötése, 2026-09-18): különben a szám helyre áll, és
 * cserébe az egyetlen útbaigazítás tűnik el.
 *
 * === A SORREND UGYANAZ, MINT A WEBEN, ÉS UGYANAZÉRT ===
 *
 * A séma `@@unique([worksheetVersionId, type])` megkötése miatt egy verzióhoz
 * legfeljebb egy kiadott lap tartozik; több verzió több lapot jelent. A
 * legfrissebb áll elöl, mert az tartozik a mai verzióhoz.
 */

/**
 * A SZERVER ENUM-ERTEKE, EGY HELYEN NEVESITVE.
 *
 * A telefon a `type` mezot sima `string`-kent kapja (lasd a
 * `ServiceDocumentSummary` fejlecet), tehat a forditó nem ellenorzi ezt az
 * erteket. Egy elgepeles NEMA lenne: minden dokumentum csatolmanynak
 * szamitana, es a kepernyo pontosan ugy nezne ki, mint ma.
 *
 * Ezert all kulon konstansban, es ezert meri egy allitas a szerver enumjahoz
 * (`apps/api/src/mobile/...`): egy nevesitett ertek legalabb EGY helyen
 * javithato, es egy helyen ellenorizheto.
 */
export const ISSUED_SHEET_TYPE = "GENERATED_SHEET";

export interface IssuedSheetSplit {
  /** A rendszer által kiadott lapok, LEGFRISSEBB ELŐL. */
  issued: ServiceDocumentSummary[];
  /** Minden más: amit ember töltött fel. A meglévő sorrend változatlan. */
  attachments: ServiceDocumentSummary[];
}

export function splitIssuedSheet(
  items: readonly ServiceDocumentSummary[],
): IssuedSheetSplit {
  const issued = items.filter((item) => item.type === ISSUED_SHEET_TYPE);
  return {
    // A RENDEZES MASOLATON MEGY (`filter` mar uj tombot ad): a hivo listaja
    // valtozatlan marad, tehat a csatolmanyok sorrendje nem mozdul el.
    issued: issued.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    attachments: items.filter((item) => item.type !== ISSUED_SHEET_TYPE),
  };
}

/**
 * A KIADOTT LAP SORA -- ÉS BENNE MARAD AZ ÚTBAIGAZÍTÁS.
 *
 * A telefonon nincs letöltés, tehát ez a mondat az EGYETLEN, ami megmondja,
 * hol lehet megnyitni. A szétválasztás előtt a `describeUnviewableDocument`
 * hordozta; ha a saját szakaszban elhagynánk, a szám helyre állna, és cserébe
 * az útbaigazítás tűnne el.
 *
 * A TARTALOM-TÍPUS ITT NEM SZEREPEL, szemben a csatolmány-sorral: ott azért
 * áll, mert bármi lehet; itt mindig a kiadott PDF, és a fajtát a szakasz címe
 * már kimondta.
 */
export function describeIssuedSheet(doc: ServiceDocumentSummary): string {
  return `${doc.fileName} -- a webes felületen nyitható meg.`;
}
