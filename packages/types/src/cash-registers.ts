export interface CashRegisterReceiptListResponse {
  day: string;
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    id: string;
    apNumber: string;
    receiptNumber: string;
    issuedAt: string;
    total: string;
    paymentMeans: string;
    cancelled: boolean;
    kind: "SALE" | "STORNO" | "RETURN";
    validationCode: string;
    lines: Array<{
      name: string;
      quantity: string;
      sum: string;
      vatCode: string;
    }>;
  }>;
  summary: {
    count: number;
    total: string;
    payments: Array<{ category: string; amount: string }>;
  };
  gaps: Array<{
    apNumber: string;
    fromFileNumber: number;
    toFileNumber: number;
    detectedAt: string;
    reason: string;
  }>;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    errorCode: string | null;
  } | null;
}
