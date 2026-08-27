import { apiRequest } from "./client";

/**
 * MUNKALAPOK, OLVASÁSRA.
 *
 * A telefonon a munkalap MUNKAUTASÍTÁS: a szerelő azt nézi meg, mit kell
 * csinálni, hol, és kire van kiosztva. A lap megírása, lezárása és aláíratása
 * ma a webes felületen történik, ezért ez a modul csak olvas.
 *
 * A szerver ugyanazzal a jogosultsággal védi a munkalapot, mint az eszközöket
 * (`service.view` az olvasáshoz, `service.manage` az íráshoz), tehát az írás
 * itt NEM jogosultsági kérdés, hanem szándékos szűkítés: egy félkész lap-írás
 * a telefonon olyan állapotot hozna létre, amit csak a webes felület tud
 * befejezni.
 *
 * A típusok SAJÁT másolatok, nem a `@acropora/types` csomagból jönnek: az Expo
 * app szándékosan nem húzza be a pnpm munkatér csomagjait (lásd
 * `docs/MOBILE-DEVELOPMENT.md`). A neveik a szerveréi, hogy a két oldal
 * összevetése olvasásra is elvégezhető legyen.
 */

export type WorksheetVersionStatus =
  "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";

export interface WorksheetListItem {
  id: string;
  /** `null`, amíg a lap piszkozat: a sorszám a lezáráskor keletkezik. */
  number: string | null;
  /** A szám a verzióval együtt (`BIO-2026-001/2`), vagy `null` piszkozaton. */
  label: string | null;
  customerName: string;
  departmentCode: string;
  subject: string;
  status: WorksheetVersionStatus;
  version: number;
  versionCount: number;
  grossAmount: string;
  /** A felelősök neve. Üres tömb, ha a lap még nincs kiosztva. */
  assigneeNames: string[];
  updatedAt: string;
}

export interface WorksheetListResponse {
  items: WorksheetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface WorksheetAssignee {
  userId: string;
  name: string;
  assignedAt: string;
}

export interface WorksheetLineDetail {
  id: string;
  position: number;
  description: string;
  detail: string | null;
  assetId: string | null;
  assetNumber: string | null;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface WorksheetSignatureDetail {
  decision: "ACCEPTED" | "REJECTED";
  signerName: string;
  signedByName: string | null;
  signedAt: string;
  note: string | null;
}

export interface WorksheetVersionSummary {
  id: string;
  version: number;
  label: string | null;
  status: WorksheetVersionStatus;
  changeReason: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  signature: WorksheetSignatureDetail | null;
}

export interface WorksheetVersionDetail extends WorksheetVersionSummary {
  subject: string;
  unitName: string | null;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  currency: string;
  lines: WorksheetLineDetail[];
}

/** Egy szem a folytatás-láncban. A szám `null`, amíg az a lap piszkozat. */
export interface WorksheetChainLink {
  id: string;
  number: string | null;
}

export interface WorksheetDetail {
  id: string;
  number: string | null;
  customer: {
    id: string;
    customerNumber: string;
    displayName: string;
    worksheetPartnerCode: string | null;
  };
  department: {
    id: string;
    code: string;
    name: string;
  };
  createdByName: string | null;
  assignees: WorksheetAssignee[];
  createdAt: string;
  updatedAt: string;
  continues: WorksheetChainLink | null;
  continuedBy: WorksheetChainLink[];
  currentVersion: WorksheetVersionDetail;
  versions: WorksheetVersionSummary[];
}

export interface WorksheetListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  /**
   * A SAJÁT LAPOK szűrője. A szerver szűr, nem a telefon: egy már lapozott
   * halmazból itt kiszedni az idegen sorokat annyi lenne, mint huszonöt sor
   * helyett hármat mutatni egy oldalon, miközben a darabszám a többit is
   * beleszámolja.
   */
  assigneeId?: string;
}

export function listWorksheets({
  page = 1,
  pageSize = 25,
  search = "",
  assigneeId,
}: WorksheetListParams = {}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) query.set("search", search.trim());
  if (assigneeId) query.set("assigneeId", assigneeId);
  return apiRequest<WorksheetListResponse>(`/worksheets?${query}`);
}

export function getWorksheet(id: string) {
  return apiRequest<WorksheetDetail>(`/worksheets/${encodeURIComponent(id)}`);
}
