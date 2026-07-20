import type { UnasProductSyncAction } from "./unas-api.js";

export interface UnasProductSyncSummary {
  runId: string;
  status: "APPLIED";
  productsSeen: number;
  counts: Record<UnasProductSyncAction, number>;
  missingCount: number;
  windowStart: string | null;
  windowEnd: string;
}

export type UnasProductSyncKind = "FULL" | "INCREMENTAL";
export type UnasProductSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface UnasProductSyncRun {
  id: string;
  kind: UnasProductSyncKind;
  status: UnasProductSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  productsSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  missingCount: number;
  errorCode: string | null;
}
