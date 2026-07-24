export type NavIncomingInvoiceStatus =
  "NEW" | "DATA_FETCHED" | "RECEIVED" | "ERROR";

export interface NavIncomingInvoiceSummary {
  id: string;
  navInvoiceNumber: string;
  supplierTaxNumber: string;
  supplierName: string;
  invoiceIssueDate: string;
  invoiceDeliveryDate?: string;
  paymentDate?: string;
  currency: string;
  invoiceNetAmount?: string;
  invoiceVatAmount?: string;
  insDate: string;
  status: NavIncomingInvoiceStatus;
  purchaseInvoiceId?: string;
  errorCode?: string;
}

export interface NavIncomingInvoiceAddress {
  postalCode: string;
  city: string;
  line1: string;
  country: string;
}

export interface NavIncomingInvoiceLine {
  lineNumber: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice?: string;
  lineNetAmount: string;
  vatRatePercent?: string;
}

export interface NavIncomingInvoiceDetail extends NavIncomingInvoiceSummary {
  supplierAddress?: NavIncomingInvoiceAddress;
  supplierBankAccountNumber?: string;
  /** A tételek leggyakoribb ÁFA-kulcsa - a bevételező űrlap egyetlen, számla-szintű ÁFA-kulcs mezőjének előtöltéséhez. */
  suggestedVatRatePercent?: string;
  lines: NavIncomingInvoiceLine[];
}

export interface NavIncomingInvoiceListResponse {
  items: NavIncomingInvoiceSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export type NavInvoiceSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface NavInvoiceSyncRun {
  id: string;
  status: NavInvoiceSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  errorCode: string | null;
}

export interface NavInvoiceSyncSummary {
  runId: string;
  status: "APPLIED";
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  windowStart: string | null;
  windowEnd: string;
}
