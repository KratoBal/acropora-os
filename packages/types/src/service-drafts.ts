export type ServiceDraftStatus = "PENDING" | "ACCEPTED" | "REJECTED";
/**
 * A Jev-szűrés állapota (Cápasuli, Balázs 2026-10-05): UNFILTERED "nem szűrt",
 * PASSED nekünk szóló hiba, UNCERTAIN "bizonytalan", FILTERED a "Kiszűrve"
 * szakaszban, PROMOTED ember hozta vissza ("Mégis piszkozat").
 */
export type ServiceDraftFilterState =
  "UNFILTERED" | "PASSED" | "UNCERTAIN" | "FILTERED" | "PROMOTED";
/** A Jev három osztálya (`CAPASULI_ITEM_CLASSES`). */
export type ServiceDraftJevClass =
  "OUR_TECHNICAL_FAULT" | "NOT_OURS" | "NOT_A_FAULT";
export interface ServiceDraftItem {
  reporterPersonName?: string | null;
  id: string;
  title: string;
  originalProblem: string;
  reportDate: string;
  createdAt: string;
  status: ServiceDraftStatus;
  proposedDepartmentId: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  acceptedServiceJobId: string | null;
  mail: { originalText: string; subject: string | null; mailbox: string };
  attachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
  filterState: ServiceDraftFilterState;
  jevClass: string | null;
  jevConfidence: number | null;
  occurrence: number;
  earlier: Array<{
    id: string;
    reportDate: string;
    acceptedServiceJobId: string | null;
    status: ServiceDraftStatus;
  }>;
}
export interface ServiceDraftListResponse {
  items: ServiceDraftItem[];
  nextCursor: string | null;
  locations: Array<{
    id: string;
    parentId: string | null;
    name: string;
    customerId: string;
  }>;
  openedBy: { id: string; name: string } | null;
  /** Be van-e kapcsolva a Jev-szűrés; a "nem szűrt" jel csak ekkor mond valamit. */
  filterEnabled: boolean;
  /** A "Kiszűrve" szakasz: függő, kiszűrt tételek (csak a PENDING fülön). */
  filtered: ServiceDraftFilteredItem[];
}
export interface ServiceDraftFilteredItem {
  id: string;
  title: string;
  originalProblem: string;
  reportDate: string;
  jevClass: string | null;
  jevConfidence: number | null;
}
export interface ServiceDraftSyncStatus {
  enabled: boolean;
  switchReason: string;
  configured: boolean;
  mailbox: string;
  query: string;
  intervalMinutes: number;
  description: string;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}
