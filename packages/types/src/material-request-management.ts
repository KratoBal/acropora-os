/**
 * ANYAGIGENYLES A MUNKALAPROL -- A KOZOS VALASZ-ALAKOK.
 *
 * Balazs szo szerinti kerese, 2026-09-22 12:15:46 UTC: a szervizes munka
 * kozben veszi eszre, hogy kell valami, felviszi a teteleket, kulon "elkuld"
 * gombbal elkuldi. A teljes indoklas az API oldalon all
 * (`apps/api/src/material-requests/material-requests.service.ts` es a sema
 * fejlecei) -- ez a fajl csak az ALAKOT hordozza, amit a web es (kesobb) a
 * mobil is olvas.
 *
 * MIERT A KOZOS CSOMAGBAN: ugyanaz az indok, mint a `WorksheetEntryDetail`-nel
 * -- egy masolat a web es az api kozott elobb-utobb szetcsuszna, es a mobil
 * (ha majd a sajat tukret irja) ugyanezt a nevet fogja keresni.
 */

export type MaterialRequestStatusValue = "DRAFT" | "OPEN" | "RECEIVED";

export interface MaterialRequestItem {
  id: string;
  /** Pl. "40mm könyök". */
  name: string;
  /** Pl. "2", vagy "10 meter" -- szabad szoveg, szandekosan validalatlan. */
  quantity: string;
  /** Pl. "db" -- szabad szoveg. */
  unit: string;
}

/** Egy tetel a felviteli urlapon -- meg nincs azonositoja. */
export interface MaterialRequestItemInput {
  name: string;
  quantity: string;
  unit: string;
}

export interface MaterialRequestDetail {
  id: string;
  worksheetId: string;
  status: MaterialRequestStatusValue;
  /** `null`, ha a kero azota torolt kollega -- lasd a sema fejlecet. */
  requestedByName: string | null;
  /** A PISZKOZAT letrehozasanak ideje, NEM az elkuldese -- lasd `submittedAt`. */
  createdAt: string;
  /** Mikor nyomta meg az "elkuld" gombot. `null`, amig DRAFT. */
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  items: MaterialRequestItem[];
}

export interface MaterialRequestListResponse {
  items: MaterialRequestDetail[];
}

/**
 * A BESZERZO SAJAT LISTAJANAK SORA -- A MUNKALAP-KONTEXTUSSAL EGYUTT, mert a
 * beszerzo TOBB igeny kozott tajekozodik, es egyetlen igeny onmagaban nem
 * mondja meg, MELYIK munkarol van szo.
 */
export interface PendingMaterialRequest extends MaterialRequestDetail {
  worksheetNumber: string | null;
  customerDisplayName: string;
  departmentName: string;
}

export interface PendingMaterialRequestListResponse {
  items: PendingMaterialRequest[];
}

export interface CreateMaterialRequestInput {
  items: MaterialRequestItemInput[];
}
