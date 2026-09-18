import type { WorksheetDocumentSummary } from "@acropora/types";

/**
 * A KIADOTT MUNKALAP KÜLÖNVÁLASZTÁSA A CSATOLMÁNYOKTÓL.
 *
 * === MIÉRT NEM EGY LISTA (acrobot döntése, 2026-09-18) ===
 *
 * 1. A csatolmány az, amit VALAKI FELTÖLTÖTT; a lap az, amit a RENDSZER ADOTT
 *    KI. Egy listában a felhasználó nem tudja megmondani, melyik a hiteles
 *    példány -- és épp erre a fájlra fog a partner hivatkozni.
 * 2. A munkalap-oldal nem ad törlés-gombot, tehát a kiadott lap az EGYETLEN
 *    fájl abban a panelben, amit nem lehet eltávolítani (nautilus mérése). Egy
 *    lista, aminek egy eleme másképp viselkedik, magyarázatot kíván -- vagy
 *    külön helyet.
 *
 * === VERZIÓNKÉNT PONTOSAN EGY LAP LEHET, ÉS EZT A SÉMA TARTJA ===
 *
 * A `WorksheetDocument` modellen `@@unique([worksheetVersionId, type])` áll,
 * tehát egy verzióhoz legfeljebb egy `GENERATED_SHEET` tartozik. Több verzió
 * viszont több lapot jelent, egyet-egyet.
 *
 * EBBŐL KÖVETKEZIK A SORREND, ÉS NEM ÍZLÉS KÉRDÉSE: a LEGFRISSEBB áll elöl,
 * mert az tartozik a mai verzióhoz; a régebbiek előzmények. Fordítva a lap
 * tetején egy elavult példány állna, és épp az a fájl, amire hivatkozni fognak.
 *
 * === AMIT EZ NEM VÁLTOZTAT MEG ===
 *
 * A letöltési út. Mind a két szakasz ugyanazt a végpontot hívja, ugyanazzal a
 * gombbal: a szétválasztás a MEGJELENÍTÉSRŐL szól, nem az elérésről.
 */

export interface WorksheetDocumentSplit {
  /** A rendszer által kiadott lapok, LEGFRISSEBB ELŐL. */
  issued: WorksheetDocumentSummary[];
  /** Minden más: amit ember töltött fel. A meglévő sorrend változatlan. */
  attachments: WorksheetDocumentSummary[];
}

export function splitWorksheetDocuments(
  items: readonly WorksheetDocumentSummary[],
): WorksheetDocumentSplit {
  const issued = items.filter((item) => item.type === "GENERATED_SHEET");
  return {
    /*
      A RENDEZES MASOLATON MEGY (`filter` mar uj tombot ad), tehat a hivo altal
      atadott lista valtozatlan marad. Egy helyben rendezes itt azt jelentene,
      hogy a csatolmanyok sorrendje is elmozdulhat a hivo szeme elott.
    */
    issued: issued.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    attachments: items.filter((item) => item.type !== "GENERATED_SHEET"),
  };
}
