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

export type MaterialRequestStatusValue =
  | "DRAFT"
  | "OPEN"
  /** V2: someone claimed the purchase. */
  | "IN_PROGRESS"
  /** V2: the handler placed the order (a state, a user, a time; nothing else). */
  | "ORDERED"
  /** V2: some items arrived. */
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  /** V2: withdrawn before it was ordered. */
  | "CANCELLED";

/**
 * The V2 statuses that still need someone (docs/material-requests/v2-discovery.md):
 * the "Aktív igények" view, the dashboard tile and the attention list count these.
 */
export const MATERIAL_REQUEST_ACTIVE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "ORDERED",
  "PARTIALLY_RECEIVED",
] as const satisfies readonly MaterialRequestStatusValue[];

/** V2: optional, set by the requester. */
export const MATERIAL_REQUEST_PRIORITIES = [
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;
export type MaterialRequestPriorityValue =
  (typeof MATERIAL_REQUEST_PRIORITIES)[number];

/**
 * THE LEADERS of the V2 workflow (owner decision, 2026-10-02): besides the
 * handler, only they may change a claimed request's state, reassign it, or
 * withdraw someone else's request.
 */
export const MATERIAL_REQUEST_LEADER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
] as const;

export interface MaterialRequestItem {
  id: string;
  /** Pl. "40mm könyök". */
  name: string;
  /** Pl. "2", vagy "10 meter" -- szabad szoveg, szandekosan validalatlan. */
  quantity: string;
  /** Pl. "db" -- szabad szoveg. */
  unit: string;
  /**
   * V2: the quantity as a decimal string ("2.5"), only when the text is a
   * plain number; `null` otherwise. The ratio ("12/14 db") is shown only
   * where this exists; elsewhere the item gets a plain "megjött" mark.
   */
  quantityValue: string | null;
  /** V2: how much arrived, decimal string, for a numeric item. */
  receivedQuantity: string | null;
  /** V2: when the item counted as arrived. */
  receivedAt: string | null;
  /** V2: the item has fully arrived. */
  arrived: boolean;
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
  /** V2: the current handler ("Intézi"), and since when. */
  handlerId: string | null;
  handlerName: string | null;
  handlerAssignedAt: string | null;
  orderedAt: string | null;
  orderedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  /** V2: the requester's own short note. */
  note: string | null;
  /** V2: `YYYY-MM-DD`, or `null`. */
  neededBy: string | null;
  priority: MaterialRequestPriorityValue | null;
}

export interface MaterialRequestListResponse {
  items: MaterialRequestDetail[];
  /**
   * FIGYELMEZTETES, HOGY MA SENKI NEM TUDJA JELOLNI A BEERKEZEST.
   *
   * ELHAGYHATO, ES SZANDEKOSAN CSAK A KULDES (`submit`) VALASZABAN TOLTODIK
   * KI -- lasd a szerver `MaterialRequestsService.submit` fejleceit, miert
   * ott es csak ott. A `listForWorksheet`/`listPending` valasza is ezt a
   * tipust hasznalja, de azokban ez a mezo mindig hianyzik: a figyelmeztetes
   * a KULDES PILLANATARA szol, nem egy listazasra.
   *
   * A KULDEST NEM AKADALYOZZA -- az igeny akkor is letrejon, ha senki nem
   * tudja majd jelolni. Ez tajekoztatas, nem kapu.
   */
  warning?: string;
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

/**
 * AZ ELOZMENYEK SORA -- UGYANAZ AZ ALAK, MINT A `PendingMaterialRequest`, DE
 * MAS A LEKERDEZES: `OPEN` ES `RECEIVED` allapotu sorokat egyarant hordoz, a
 * `DRAFT`-ot nem (lasd `MaterialRequestsRepository.listHistory` fejlecet).
 *
 * Balazs szo szerinti kerese, 2026-09-23 20:08:57 UTC: "jo lenne ha
 * valamilyen modon kepzodne valami lista, ahol azert vissza lehet nezni, mi
 * volt az igeny, mikor erkezett, mikor ment ra a valasz stb".
 */
export interface MaterialRequestHistoryEntry extends MaterialRequestDetail {
  worksheetNumber: string | null;
  customerDisplayName: string;
  departmentName: string;
}

export interface MaterialRequestHistoryListResponse {
  items: MaterialRequestHistoryEntry[];
}

export interface CreateMaterialRequestInput {
  items: MaterialRequestItemInput[];
  /** V2, optional. */
  note?: string;
  /** V2, optional, `YYYY-MM-DD`. */
  neededBy?: string;
  /** V2, optional. */
  priority?: MaterialRequestPriorityValue;
}

// ---------------------------------------------------------------------------
// V2 (docs/material-requests/v2-discovery.md)

/** One row of the V2 overview list: the request with its worksheet context. */
export interface MaterialRequestSummary extends MaterialRequestDetail {
  worksheetNumber: string | null;
  customerDisplayName: string;
  departmentName: string;
}

export const MATERIAL_REQUEST_VIEWS = [
  /** OPEN, IN_PROGRESS, ORDERED, PARTIALLY_RECEIVED */
  "active",
  /** "Saját beszerzéseim": active, handled by the caller */
  "mine",
  "received",
  "cancelled",
] as const;
export type MaterialRequestView = (typeof MATERIAL_REQUEST_VIEWS)[number];

export interface MaterialRequestPage {
  items: MaterialRequestSummary[];
  /** Pass back as `cursor` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

/** The overview's status cards, scoped like the list. */
export interface MaterialRequestStatusCounts {
  open: number;
  inProgress: number;
  ordered: number;
  partiallyReceived: number;
  /** RECEIVED in the last 7 days (the Figma card says "utóbbi 7 nap"). */
  receivedLast7Days: number;
}

export type MaterialRequestEventKindValue =
  | "SUBMITTED"
  | "CLAIMED"
  | "REASSIGNED"
  | "ORDERED"
  | "ITEMS_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface MaterialRequestEventEntry {
  id: string;
  kind: MaterialRequestEventKindValue;
  fromStatus: MaterialRequestStatusValue | null;
  toStatus: MaterialRequestStatusValue | null;
  actorName: string | null;
  createdAt: string;
  /** REASSIGNED: the previous and the new handler's name. */
  previousHandlerName?: string | null;
  newHandlerName?: string | null;
}

export interface MaterialRequestCommentEntry {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

/** What THIS caller may do now, computed by the server from the same rules it enforces. */
export interface MaterialRequestActions {
  claim: boolean;
  reassign: boolean;
  order: boolean;
  receiveItems: boolean;
  receive: boolean;
  cancel: boolean;
  comment: boolean;
}

export interface MaterialRequestFullDetail extends MaterialRequestSummary {
  worksheetHref: string;
  events: MaterialRequestEventEntry[];
  comments: MaterialRequestCommentEntry[];
  actions: MaterialRequestActions;
}

/** A 409 on a lost claim carries the authoritative current request. */
export interface MaterialRequestConflictBody {
  message: string;
  current: MaterialRequestFullDetail;
}

export interface MaterialRequestReceiveItemsInput {
  items: {
    itemId: string;
    /** Numeric items: the new TOTAL received (not a delta), decimal string. */
    receivedQuantity?: string;
    /** Text items: the "megjött" mark. */
    arrived?: boolean;
  }[];
}

export interface MaterialRequestReassignInput {
  handlerId: string;
}

export interface MaterialRequestCommentInput {
  body: string;
}

/** A user who can be chosen as handler in the reassignment list. */
export interface MaterialRequestHandlerOption {
  id: string;
  displayName: string;
}
