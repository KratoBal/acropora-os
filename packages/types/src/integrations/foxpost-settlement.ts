export type FoxpostSettlementStatus =
  "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "ERROR";

export type FoxpostSettlementLineStatus =
  "MATCHED" | "ORDER_NOT_FOUND" | "INVOICE_NOT_FOUND";

export type FoxpostResolutionSource = "LOCAL" | "UNAS" | "MANUAL";

export interface FoxpostSettlementLine {
  id: string;
  sourceRowNumber: number;
  referenceCode: string;
  transactionDate: string;
  recipientName?: string;
  parcelBarcode?: string;
  collectedAmount: string;
  salesOrderId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  resolutionSource?: FoxpostResolutionSource;
  status: FoxpostSettlementLineStatus;
  errorCode?: string;
  manualApprovedAt?: string;
  manualApprovedByUserId?: string;
  manualApprovedByDisplayName?: string;
  /** Open line: an invoice number the reference points to, and it exists here.
   * A bare "2026/00123" gets its prefix only when exactly one series has it. */
  suggestedInvoiceNumber?: string;
  /** Open line: the reference looks like an invoice number, and we have no
   * such outgoing invoice (with any prefix). */
  referenceInvoiceMissing?: boolean;
  updatedAt: string;
}

export interface FoxpostSettlementSummary {
  id: string;
  gmailInternalDate?: string;
  gmailSubject?: string;
  partnerCode?: string;
  settlementCode?: string;
  periodStart?: string;
  periodEnd?: string;
  invoiceNumber?: string;
  invoiceIssueDate?: string;
  currency: string;
  collectedAmount?: string;
  invoiceGrossAmount?: string;
  transferredAmount?: string;
  status: FoxpostSettlementStatus;
  matchedLineCount: number;
  unresolvedLineCount: number;
  errorCode?: string;
  processedAt?: string;
  createdAt: string;
}

export interface FoxpostSettlementDetail extends FoxpostSettlementSummary {
  gmailMessageId: string;
  gmailFrom?: string;
  xlsxFileName: string;
  pdfFileName: string;
  lines: FoxpostSettlementLine[];
}

export interface FoxpostSettlementListResponse {
  items: FoxpostSettlementSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface FoxpostMonthlyReportSummary {
  id: string;
  year: number;
  month: number;
  filename: string;
  settlementCount: number;
  invoiceCount: number;
  collectedAmount: string;
  invoiceGrossAmount: string;
  transferredAmount: string;
  generatedAt: string;
  blockedByUnresolvedSettlements: number;
  unresolvedLineCount: number;
}

export interface FoxpostSyncSummary {
  runId: string;
  status: "APPLIED";
  messagesSeen: number;
  createdCount: number;
  skippedCount: number;
  needsReviewCount: number;
  failedCount: number;
}

/**
 * Whether the Gmail pull runs by itself, as the server reads its switch and
 * key: the same reader the scheduler's start-up log line uses. Measured on
 * production 2026-09-29: the pull had never run by itself in seven weeks,
 * and nothing on the page said so.
 */
export type FoxpostSyncState =
  | "ENABLED"
  | "DISABLED_NOT_SET"
  | "DISABLED_OFF"
  | "DISABLED_UNRECOGNISED"
  | "NO_KEY";

export interface FoxpostSyncRunSummary {
  status: "RUNNING" | "APPLIED" | "FAILED";
  /**
   * Who started the run: the timer or a person. Absent for runs from before
   * 2026-09-29, when this was not recorded (unknown, not "manual").
   */
  trigger?: "SCHEDULED" | "MANUAL";
  startedAt: string;
  completedAt?: string;
  messagesSeen: number;
  createdCount: number;
  skippedCount: number;
  needsReviewCount: number;
  failedCount: number;
  errorCode?: string;
}

export interface FoxpostSyncStatus {
  state: FoxpostSyncState;
  /** Whether there is a Gmail key (the manual check depends on it). */
  canRunNow: boolean;
  intervalMinutes: number;
  lastRun?: FoxpostSyncRunSummary;
  /** The newest run the timer started: whether the pull really runs by itself. */
  lastScheduledRun?: FoxpostSyncRunSummary;
}

export interface FoxpostReprocessResult {
  settlement: FoxpostSettlementDetail;
  reportRegenerated: boolean;
}

export interface FoxpostManualApprovalInput {
  invoiceNumber: string;
  expectedUpdatedAt: string;
}

export type FoxpostManualApprovalResult = FoxpostReprocessResult;
