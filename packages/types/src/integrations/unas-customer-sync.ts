export type UnasCustomerSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface UnasCustomerSyncRun {
  id: string;
  status: UnasCustomerSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  customersSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCode: string | null;
}

export interface UnasCustomerSyncSummary {
  runId: string;
  status: "APPLIED";
  customersSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  windowStart: string | null;
  windowEnd: string;
}
