/** A ticket@ levelek beolvasásának állapota az adminoknak (`GET /service/drafts/ticket-mail/status`, kártya ec7b947b). */
export interface TicketMailIntakeStatus {
  enabled: boolean;
  switchReason: string;
  configured: boolean;
  mailbox: string;
  query: string;
  intervalMinutes: number;
  maxMessagesPerRun: number;
  unknownSenderPerHour: number;
  description: string;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  /** Az utolsó futás számai (levelek, vázlatok, kihagyottak, lezártak, értesítettek), ha volt futás. */
  lastSummary: Record<string, number | boolean> | null;
}
export type ServiceDraftSource = "CAPASULI_DAILY_REPORT" | "TICKET_MAIL";
/** Egy helyszín a ticket@ vázlat elfogadásához: az ügyfél nevével (`GET /service/drafts/places`). */
export interface ServiceDraftPlace {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
}
export type ServiceDraftStatus = "PENDING" | "ACCEPTED" | "REJECTED";
/**
 * A Jev-szűrés állapota (Cápasuli, Balázs 2026-10-05): UNFILTERED "nem szűrt",
 * PASSED nekünk szóló hiba, UNCERTAIN "bizonytalan", FILTERED a "Kiszűrve"
 * szakaszban, PROMOTED ember hozta vissza ("Mégis piszkozat").
 */
export type ServiceDraftFilterState =
  "UNFILTERED" | "PASSED" | "UNCERTAIN" | "FILTERED" | "PROMOTED";
/**
 * Hogyan került a vázlat a listára (kártya ec7b947b): RULE_DRAFT a szabályalapú
 * (Cápasuli) feldolgozó vázlata, AI_DRAFT az AI töltötte ki, AI_UNAVAILABLE az AI
 * nem válaszolt (a levél vázlat nélkül látszik), WATCH_OFF ismert felhasználó
 * kikapcsolt figyeléssel, UNKNOWN_SENDER nem felhasználó vagy elbukott feladó-hitelesítés.
 */
export type ServiceDraftIntakeState =
  "RULE_DRAFT" | "AI_DRAFT" | "AI_UNAVAILABLE" | "WATCH_OFF" | "UNKNOWN_SENDER";
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
  /** Honnan jött: a Cápasuli napi jelentő vagy a ticket@ postafiók (kártya ec7b947b). */
  source: ServiceDraftSource;
  mail: {
    originalText: string;
    subject: string | null;
    mailbox: string;
    /** A ticket@ levél feladójának címe (a `From` fejlécből; null: nincs vagy több cím), a Cápasuli soroknál null. */
    fromAddress: string | null;
    /** Hány csatolmány maradt ki (típus, méret vagy darabszám miatt). */
    droppedAttachments: number;
  };
  attachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
  filterState: ServiceDraftFilterState;
  intakeState: ServiceDraftIntakeState;
  /** Az AI rövid összefoglalója a redaktált levélből (csak megjelenítésre; a jegy leírása az eredeti szöveg); null: az AI nem futott. */
  aiSummary: string | null;
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
