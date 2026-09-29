/**
 * GLS elszámolás: a heti utánvét-utalások csomagonként a kimenő számlákhoz
 * kötve, és a GLS díjszámlái. Két külön dokumentumból jön (a Foxposttal
 * ellentétben): a heti utánvét-részletezőből és a kéthetes számlamellékletből.
 */

export type GlsCodReportStatus = "COMPLETED" | "NEEDS_REVIEW";
export type GlsCodLineStatus = "RESOLVED" | "NEEDS_REVIEW";
export type GlsCodResolutionSource = "INVOICE_NUMBER" | "ORDER_KEY" | "MANUAL";

/**
 * Miért kell kézi ellenőrzés:
 *   INVOICE_NOT_FOUND     a hivatkozás számlaszám, de nincs ilyen kimenő számla
 *   ORDER_NOT_FOUND       a rendeléskulcshoz nincs rendelés a rendszerben
 *   ORDER_NOT_INVOICED    a rendelés megvan, számlája nincs
 *   PREFIX_MISSING        előtag nélküli számlaszám ("2026/00123"): javaslat van
 *   REFERENCE_UNKNOWN     a hivatkozás egyik ismert alak sem, és ügyfélhivatkozás sincs
 */
export type GlsCodLineError =
  | "INVOICE_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_INVOICED"
  | "PREFIX_MISSING"
  | "REFERENCE_UNKNOWN";

export interface GlsCodReportLine {
  id: string;
  rowNumber: number;
  reportNumber?: string;
  parcelNumber: string;
  codReference?: string;
  /** A díjszámla-mellékletből, ha a csomag már rajta van. */
  clientReference?: string;
  deliveryDate?: string;
  amount: string;
  invoiceNumbers: string[];
  status: GlsCodLineStatus;
  resolutionSource?: GlsCodResolutionSource;
  errorCode?: GlsCodLineError;
  suggestedInvoiceNumber?: string;
  manualApprovedAt?: string;
  manualApprovedByDisplayName?: string;
  updatedAt: string;
}

export interface GlsCodReportSummary {
  id: string;
  fileName: string;
  transferDate: string;
  currency: string;
  total: string;
  lineCount: number;
  resolvedLineCount: number;
  status: GlsCodReportStatus;
  createdAt: string;
}

export interface GlsCodReportDetail extends GlsCodReportSummary {
  lines: GlsCodReportLine[];
}

export interface GlsCodReportListResponse {
  items: GlsCodReportSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface GlsInvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate?: string;
  currency: string;
  feeTotal: string;
  cardFeeTotal: string;
  parcelCount: number;
  fileName: string;
  createdAt: string;
}

export interface GlsDocumentUploadResult {
  kind: "COD_REPORT" | "INVOICE_ATTACHMENT" | "COMPENSATION_LETTER";
  id: string;
  /** `true`: ez a dokumentum már bent volt, semmi nem változott. */
  duplicate: boolean;
  /** Díjszámla után: hány korábban feloldatlan utánvét-sor oldódott fel. */
  newlyResolvedLineCount: number;
}

export interface GlsManualApprovalInput {
  invoiceNumber: string;
  expectedUpdatedAt: string;
}

/**
 * A Gmail-behúzás állapota, ahogy a szerver maga látja: a kapcsoló és a kulcs
 * értelmezése ugyanabból a függvényből jön, mint az induló naplósor.
 */
export type GlsSyncState =
  | "ENABLED"
  | "DISABLED_NOT_SET"
  | "DISABLED_OFF"
  | "DISABLED_UNRECOGNISED"
  | "NO_KEY";

export interface GlsSyncRunSummary {
  status: "RUNNING" | "APPLIED" | "FAILED";
  startedAt: string;
  completedAt?: string;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  errorCode?: string;
}

export interface GlsSyncStatus {
  state: GlsSyncState;
  /** Van-e olvasható Gmail-kulcs (a kézi "ellenőrizd most" ettől függ). */
  canRunNow: boolean;
  intervalMinutes: number;
  lastRun?: GlsSyncRunSummary;
}
