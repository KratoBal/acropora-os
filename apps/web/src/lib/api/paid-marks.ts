import { apiRequest } from "./client";

/** A source of the paid marks, as the API names it. */
export type PaidMarkSource =
  "GLS_COD" | "FOXPOST" | "SIMPLEPAY" | "BANK_TRANSFER";
export type PaidMarksMode = "off" | "dry" | "live" | "auto";

/** The latest run of one source (`GET /billing/paid-marks/latest`). */
export interface PaidMarkRunView {
  source: PaidMarkSource;
  startedAt: string;
  finishedAt: string | null;
  writtenCount: number;
  failedCount: number;
  attentionCount: number;
  summary: Record<string, number>;
  attention: { reference: string; reason: string; detail?: string }[];
  errorCode: string | null;
  mode: "auto" | "dry";
  trigger: "schedule" | "manual";
  triggeredById: string | null;
  /** a dry run's plan: what it would mark paid */
  planned: {
    invoiceNumber: string;
    amount: string;
    date: string;
    sourceRef: string;
  }[];
}

export interface PaidMarksStatus {
  running: boolean;
  startedAt: string | null;
  sources: { source: PaidMarkSource; mode: PaidMarksMode }[];
}

export type PaidMarksRunNow =
  | {
      status: "started";
      sources: { source: PaidMarkSource; mode: PaidMarksMode }[];
    }
  | { status: "running" }
  | { status: "nothing"; reason: string };

/** A kifizetett-jelölés napi futása (kártya e64540fd): állás, legutóbbi futások, „Futtatás most”. */
export const paidMarksApi = {
  latest(token: string) {
    return apiRequest<PaidMarkRunView[]>("/billing/paid-marks/latest", token);
  },
  status(token: string) {
    return apiRequest<PaidMarksStatus>("/billing/paid-marks/status", token);
  },
  runNow(token: string) {
    return apiRequest<PaidMarksRunNow>("/billing/paid-marks/run", token, {
      method: "POST",
    });
  },
};
