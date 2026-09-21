import type { WorksheetDetail, WorksheetVersionDetail } from "@acropora/types";

import type {
  WorksheetSheetInput,
  WorksheetSheetLine,
} from "./worksheet-sheet-content.js";

/**
 * A VÁLASZBÓL A LAP BEMENETE -- TISZTA FÜGGVÉNY, KÜLÖN A TARTALOMTÓL.
 *
 * === MIÉRT KÜLÖN A `worksheet-sheet-content.ts`-TŐL ===
 *
 * A tartalom azt dönti el, MI áll a lapon és milyen sorrendben. Ez azt, hogy a
 * MEGLÉVŐ adatszerkezetből melyik mező kerül oda. A kettő külön romlik el: az
 * egyik akkor, ha rossz sorrendben rajzolunk, a másik akkor, ha rossz mezőt
 * olvasunk ki -- és a második NÉMA, mert a lap ugyanúgy elkészül.
 *
 * === A NAPLÓ KÜLÖN PARAMÉTER, ÉS EZ MÉRÉS, NEM ÍZLÉS ===
 *
 * A `WorksheetDetail` NEM hordozza a munkalap naplóját (mérve 2026-09-17: a
 * típus tizenhat mezője között nincs `entries`). Balázs viszont 22:49:52-kor
 * úgy döntött, hogy a napló rákerül a lapra.
 *
 * Ezért kap külön paramétert: így a hívó helyén LÁTSZIK, hogy egy második
 * lekérdezés kell hozzá. Ha a naplót becsempésznénk egy „majd valahonnan"
 * alakba, a hiánya üres szakaszként jelenne meg -- és senki nem tudná, hogy
 * azért üres, mert nincs bejegyzés, vagy mert nem töltöttük be.
 */

function sheetLine(
  line: WorksheetVersionDetail["lines"][number],
): WorksheetSheetLine {
  return {
    position: line.position,
    description: line.description,
    detail: line.detail,
    assetNumber: line.assetNumber,
    inventoryNumber: line.inventoryNumber,
    quantity: line.quantity,
    unit: line.unit,
    kind: line.kind,
    workerCount: line.workerCount,
    laborHours: line.laborHours,
  };
}

export function worksheetSheetInput(
  detail: WorksheetDetail,
  version: WorksheetVersionDetail,
  entries: readonly ({ body: string; authorName: string | null } | string)[],
  assigneeNames = detail.assignees.map((assignee) => assignee.name),
  photos: readonly { thumbnail: Uint8Array; caption: string | null }[] = [],
): WorksheetSheetInput {
  return {
    label: version.label,
    status: version.status,
    customerName: detail.customer.displayName,
    customerNumber: detail.customer.customerNumber,
    /*
      A HIBAJEGY SZAMA SZANDEKOSAN NEM KERUL AT, holott a valasz HORDOZZA
      (`detail.serviceJob`). Az indok a tartalom-modul fejlecen all: a lezart
      laphoz utolag is csatolhato jegy, tehat ez lenne az egyetlen sor, ami a
      fagyasztas utan is mozdulhat.

      A MEZO A VALASZBAN MARAD, es ez nem mulasztas: a lap adatlapjan nalunk
      tovabbra is latszik. Csak a VEVONEK szant lapra nem kerul ki.
    */
    departmentName: detail.department.name,
    departmentCode: detail.department.code,
    subject: version.subject,
    description: version.description,
    issueDate: version.issueDate,
    fulfillmentDate: version.fulfillmentDate,
    createdByName: version.createdByName,
    closedAt: version.closedAt,
    /*
      A FELELŐSÖK NEVE, NEM AZ AZONOSÍTÓJUK. A `WorksheetAssignee` `userId`-t is
      hordoz, és az a MI nyilvántartásunké -- a lapon a név áll, ahogy Balázs
      kérte (2026-09-17 22:49:52).
    */
    assigneeNames,
    entries,
    photos,
    lines: version.lines.map(sheetLine),
    laborHours: version.laborHours,
    signature: version.signature
      ? {
          decision: version.signature.decision,
          signerName: version.signature.signerName,
          signerSource: version.signature.signerSource,
          signedByName: version.signature.signedByName,
          signedAt: version.signature.signedAt,
          note: version.signature.note,
        }
      : null,
    /*
      AZ ELŐZMÉNY-LAP SZÁMA, NEM AZ AZONOSÍTÓJA. A `WorksheetChainLink` mindkettőt
      viszi; a vevő a SZÁMOT ismeri, a belső azonosító neki semmit nem mond.

      És csak akkor áll ki, ha van: egy folytatólagos lap önmagában félrevezető,
      mert a munka fele a másikon áll -- de ha nincs előzmény, a sor is hiányzik.
    */
    continuesLabel: detail.continues?.number ?? null,
  };
}
