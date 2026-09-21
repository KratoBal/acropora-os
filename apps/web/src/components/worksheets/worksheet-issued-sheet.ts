import { isWorksheetIssuedSheet } from "@acropora/types";
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
 * tehát egy verzióhoz TÍPUSONKÉNT legfeljebb egy lap tartozik. Több verzió
 * viszont több lapot jelent, egyet-egyet.
 *
 * ÉS 2026-09-21 ÓTA EGY VERZIÓHOZ KETTŐ IS TARTOZHAT: a lezáráskori
 * (`GENERATED_SHEET`) és az aláírás után készült végleges (`SIGNED_SHEET`).
 * Mind a kettő a RENDSZER kiadványa, tehát ugyanabba a szakaszba tartoznak --
 * a `SIGNED_SHEET` később keletkezik, így a lenti rendezés magától előre teszi.
 *
 * A HALMAZ KÖZÖS KONSTANSBÓL JÖN (`isWorksheetIssuedSheet`), nem itt leírt
 * felsorolásból: ugyanezt a kérdést a hibajegy-csomag is felteszi, és két
 * másolat közül a második az új értéknél marad le. A hiba NÉMA lenne -- a
 * végleges lap a feltöltött csatolmányok közé csúszna.
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
  const issued = items.filter((item) => isWorksheetIssuedSheet(item.type));
  return {
    /*
      A RENDEZES MASOLATON MEGY (`filter` mar uj tombot ad), tehat a hivo altal
      atadott lista valtozatlan marad. Egy helyben rendezes itt azt jelentene,
      hogy a csatolmanyok sorrendje is elmozdulhat a hivo szeme elott.
    */
    issued: issued.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    attachments: items.filter((item) => !isWorksheetIssuedSheet(item.type)),
  };
}
