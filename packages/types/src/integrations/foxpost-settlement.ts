export type FoxpostSettlementStatus =
  "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "ERROR";

export type FoxpostSettlementLineStatus =
  "MATCHED" | "ORDER_NOT_FOUND" | "INVOICE_NOT_FOUND";

export type FoxpostResolutionSource = "LOCAL" | "UNAS";

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

export interface FoxpostReprocessResult {
  settlement: FoxpostSettlementDetail;
  reportRegenerated: boolean;
}
