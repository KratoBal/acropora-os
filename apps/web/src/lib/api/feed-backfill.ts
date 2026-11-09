import { apiRequest } from "./client";

/** A feed visszatöltésének állapota (`GET /billing/paid-marks/feed-backfill`; 6fd8c574). */
export interface FeedBackfillStatus {
  running: {
    phase: "dry" | "apply";
    startedAt: string;
    done: number;
    total: number;
  } | null;
  last: {
    phase: "dry" | "apply";
    finishedAt: string;
    done: number;
  } | null;
  year: number;
  /** sorozatonként a feedből hiányzó számok darabja, és a tárolt legnagyobb szám */
  series: { series: string; highest: string; missing: number }[];
  /** sorozatonként kimenetenként, ahogy a Számlázz.hu felelt: WOULD_STORE, STORED, NOT_FOUND, ERROR, ... */
  checked: Record<string, Record<string, number>>;
}

export type FeedBackfillStart =
  | { status: "started"; phase: "dry" | "apply"; total: number }
  | { status: "running" }
  | { status: "nothing"; phase: "dry" | "apply" };

/** A tárolt Számlázz.hu feed visszatöltése az év elejéig (6fd8c574): állapot, száraz kör, behúzás. */
export const feedBackfillApi = {
  status(token: string) {
    return apiRequest<FeedBackfillStatus>(
      "/billing/paid-marks/feed-backfill",
      token,
    );
  },
  start(token: string, apply: boolean) {
    return apiRequest<FeedBackfillStart>(
      "/billing/paid-marks/feed-backfill",
      token,
      { method: "POST", body: JSON.stringify({ apply }) },
    );
  },
};
