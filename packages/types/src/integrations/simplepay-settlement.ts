/**
 * SimplePay elszámolás: a heti "Forgalmi kimutatás" kártyás fizetései,
 * tranzakciónként a webshop-rendeléshez és a kimenő számlájához kötve (Balázs,
 * 2026-09-30 12:07 UTC: "kellene egy simple pay kimutatás is mint a foxpostnál
 * és a gls-nél"). Luca kézi táblájának automatikus változata.
 */

export type SimplePayReportStatus = "COMPLETED" | "NEEDS_REVIEW";
export type SimplePayLineStatus = "RESOLVED" | "NEEDS_REVIEW";
export type SimplePayResolutionSource = "ORDER_KEY" | "MANUAL";

/**
 * Miért kell kézi ellenőrzés:
 *   REFERENCE_UNKNOWN   a kereskedői azonosítóból nem olvasható ki a rendelés
 *   ORDER_NOT_FOUND     a rendeléskulcshoz nincs rendelés a rendszerben
 *   ORDER_AMBIGUOUS     több rendelés végződik ugyanarra a kulcsra, és az összeg
 *                       sem dönt
 *   AMOUNT_MISMATCH     a rendelés megvan, de a végösszege nem a fizetett összeg
 *   ORDER_NOT_INVOICED  a rendelés megvan, számlája nincs
 */
export type SimplePayLineError =
  | "REFERENCE_UNKNOWN"
  | "ORDER_NOT_FOUND"
  | "ORDER_AMBIGUOUS"
  | "AMOUNT_MISMATCH"
  | "ORDER_NOT_INVOICED";

export interface SimplePayTransactionLine {
  id: string;
  rowNumber: number;
  transactionStatus: string;
  simplePayTransactionId: string;
  merchantTransactionId: string;
  /** A tranzakció helyi (budapesti) ideje, ahogy a SimplePay írja. */
  transactionAt: string;
  amount: string;
  commission: string;
  netAmount: string;
  /** A feloldott webshop-rendelés száma (UNAS-47679-628506). */
  orderNumber?: string;
  /** A rendelés végösszege, ha a rendelés megvan: az eltérés ebből látszik. */
  orderTotal?: string;
  invoiceNumbers: string[];
  status: SimplePayLineStatus;
  resolutionSource?: SimplePayResolutionSource;
  errorCode?: SimplePayLineError;
  manualApprovedAt?: string;
  manualApprovedByDisplayName?: string;
  updatedAt: string;
}

export interface SimplePayReportSummary {
  id: string;
  fileName: string;
  /** A kimutatás napja (a fájlnévből: report_YYYYMMDD.csv), ha kiolvasható. */
  reportDate?: string;
  /** A levél törzséből, ha levélből jött. */
  periodStart?: string;
  periodEnd?: string;
  currency: string;
  amountTotal: string;
  commissionTotal: string;
  netTotal: string;
  lineCount: number;
  resolvedLineCount: number;
  status: SimplePayReportStatus;
  /** A fájl saját figyelmeztetései (nem összeadódó sor, eltérés a levéltől). */
  warnings: string[];
  createdAt: string;
}

export interface SimplePayReportDetail extends SimplePayReportSummary {
  lines: SimplePayTransactionLine[];
}

export interface SimplePayReportListResponse {
  items: SimplePayReportSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface SimplePayReportUploadResult {
  id: string;
  /** `true`: ez a kimutatás már bent volt, semmi nem változott. */
  duplicate: boolean;
  resolvedLineCount: number;
  lineCount: number;
}

export interface SimplePayManualApprovalInput {
  /** A kimenő számla száma, amit ez a fizetés fizetett. */
  invoiceNumber: string;
  expectedUpdatedAt: string;
}

/**
 * A Gmail-behúzás állapota, ahogy a szerver maga látja: a kapcsoló és a kulcs
 * értelmezése ugyanabból a függvényből jön, mint az induló naplósor.
 */
export type SimplePaySyncState =
  | "ENABLED"
  | "DISABLED_NOT_SET"
  | "DISABLED_OFF"
  | "DISABLED_UNRECOGNISED"
  | "NO_KEY";

export interface SimplePaySyncRunSummary {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: "SCHEDULED" | "MANUAL";
  startedAt: string;
  completedAt?: string;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  errorCode?: string;
}

export interface SimplePaySyncStatus {
  state: SimplePaySyncState;
  /** Van-e olvasható Gmail-kulcs (a kézi "ellenőrizd most" ettől függ). */
  canRunNow: boolean;
  intervalMinutes: number;
  lastRun?: SimplePaySyncRunSummary;
  /** A legutóbbi, időzítő indította futás: tényleg fut-e magától. */
  lastScheduledRun?: SimplePaySyncRunSummary;
}
