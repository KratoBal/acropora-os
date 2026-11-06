import { apiRequest } from "./client";

/** A source of the paid marks, as the API names it. */
export type PaidMarkSource =
  "GLS_COD" | "FOXPOST" | "SIMPLEPAY" | "BANK_TRANSFER";
export type PaidMarksMode = "off" | "dry" | "live" | "auto";

/** Egy figyelmet kérő sor; a `key` a tartós kulcsa (banki átutalásnál a jóváírás), nélküle a `reference`. */
export interface PaidMarkAttentionItem {
  reference: string;
  reason: string;
  key?: string;
  detail?: string;
}

/** The latest run of one source (`GET /billing/paid-marks/latest`). */
export interface PaidMarkRunView {
  source: PaidMarkSource;
  startedAt: string;
  finishedAt: string | null;
  writtenCount: number;
  failedCount: number;
  attentionCount: number;
  summary: Record<string, number>;
  attention: PaidMarkAttentionItem[];
  /** a kézzel rendezettnek jelölt sorok (6fd8c574): nem kérnek figyelmet, de látszik, ki és mikor zárta le őket */
  settled: (PaidMarkAttentionItem & { closedAt: string; closedBy: string })[];
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
  /** a napi futás következő időpontja (ISO); `null`, ha nincs ütemezve */
  nextRunAt: string | null;
  sources: { source: PaidMarkSource; mode: PaidMarksMode }[];
}

/** Egy forrás száraz előnézete korhatár nélkül: mit jelölne kifizetettre (`GET /billing/paid-marks/all-time-preview`). */
export interface AllTimePreview {
  source: PaidMarkSource;
  mode: PaidMarksMode;
  /** amit az író tényleg megkísérelne (a saját ellenőrzései után) */
  planned: PaidMarkRunView["planned"];
  /** amit az író kihagyna, okonként: LOGGED_BEFORE, ALREADY_PAID, NOT_UNPAID, UNCERTAIN_BEFORE */
  skipped: Record<string, number>;
  attentionCount: number;
  summary: Record<string, number>;
  errorCode: string | null;
}

export type PaidMarksRunNow =
  | {
      status: "started";
      sources: { source: PaidMarkSource; mode: PaidMarksMode }[];
    }
  | { status: "running" }
  | { status: "nothing"; reason: string };

/** Egy szám a behúzásból (`POST /billing/paid-marks/feed-pull`); a `detail` a szám, a fajta és az összegek, vevő nélkül. */
export interface FeedPullLine {
  number: string;
  outcome:
    | "WOULD_STORE"
    | "STORED"
    | "NOT_FOUND"
    | "ERROR"
    | "UNREADABLE"
    | "OTHER_NUMBER";
  detail: string;
  stored?: "NEW" | "NEW_VERSION" | "SEEN";
  projected?: string;
}

/** A kifizetett-jelölés napi futása (kártya e64540fd): állás, legutóbbi futások, „Futtatás most”. */
export const paidMarksApi = {
  latest(token: string) {
    return apiRequest<PaidMarkRunView[]>("/billing/paid-marks/latest", token);
  },
  status(token: string) {
    return apiRequest<PaidMarksStatus>("/billing/paid-marks/status", token);
  },
  /** `allTime`: egyszer korhatár nélkül (acrobot 43776), csak a száraz előnézet után (43822); alapból a napi ablak. */
  runNow(token: string, options: { allTime?: boolean } = {}) {
    return apiRequest<PaidMarksRunNow>("/billing/paid-marks/run", token, {
      method: "POST",
      ...(options.allTime ? { body: JSON.stringify({ allTime: true }) } : {}),
    });
  },
  /** A korhatár nélküli futás száraz előnézete forrásonként (acrobot 43822): nem ír semmit. */
  allTimePreview(token: string) {
    return apiRequest<AllTimePreview[]>(
      "/billing/paid-marks/all-time-preview",
      token,
    );
  },
  /** A feedből hiányzó számla a Számlázz.hu-ból (aeddb2c3): `apply: false` az előnézet, `true` a behúzás. */
  feedPull(token: string, numbers: string[], apply: boolean) {
    return apiRequest<FeedPullLine[]>("/billing/paid-marks/feed-pull", token, {
      method: "POST",
      body: JSON.stringify({ numbers, apply }),
    });
  },
  /** „Kézzel rendezve” (6fd8c574): `closed: true` lezárja a sort, `false` visszavonja; csak a mi listánkat zárja. */
  closeAttention(
    token: string,
    input: {
      source: PaidMarkSource;
      key: string;
      reason: string;
      closed: boolean;
    },
  ) {
    return apiRequest<{ changed: boolean }>(
      "/billing/paid-marks/attention-closure",
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
};
