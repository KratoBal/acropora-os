import { apiRequest } from "./client";

/** A kontroll-kérdés: a sorozat legnagyobb tárolt száma, amely a feedben van, tehát a Számlázz.hu-ban is létezik. */
export interface FeedControlResult {
  series: string;
  number: string;
  outcome: string;
  /** a Számlázz.hu hibakódja és üzenete, vagy a hiba alakja */
  detail: string;
  passed: boolean;
  /** a sorozat nem a mi Számlázz.hu fiókunkból való (a kontroll 7-et kapott, az OS saját számlája viszont megvan): nem kontroll-bukás */
  foreign?: boolean;
  /** a bukott kontroll diagnosztikája, soronként egy mondat */
  diagnostics?: string[];
}

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
  /** a legutóbbi ellenőrző kör kontrollja; `null`, amíg nem futott */
  control: { checkedAt: string; results: FeedControlResult[] } | null;
  year: number;
  /** sorozatonként a feedből hiányzó számok darabja, és a tárolt legnagyobb szám */
  series: { series: string; highest: string; missing: number }[];
  /** sorozatonként kimenetenként, ahogy a Számlázz.hu felelt: WOULD_STORE, STORED, NOT_FOUND (csak sikeres kontroll után), UNVERIFIED, ERROR, ...; NOT_OUR_ACCOUNT: a sorozat nem a mi fiókunkból való */
  checked: Record<string, Record<string, number>>;
}

export type FeedBackfillStart =
  | { status: "started"; phase: "dry" | "apply"; total: number }
  | { status: "running" }
  | { status: "nothing"; phase: "dry" | "apply" }
  | { status: "control-failed"; control: FeedControlResult[] };

/** A "nem a mi fiókunk" ítélet visszavonása (acrobot 58207): törölve, nincs ilyen ítélet, vagy épp kör fut. */
export type FeedBackfillRecheck =
  | { status: "cleared"; series: string }
  | { status: "not-foreign"; series: string }
  | { status: "running" };

/** A tárolt Számlázz.hu feed visszatöltése az év elejéig (6fd8c574): állapot, száraz kör, behúzás. */
export const feedBackfillApi = {
  status(token: string) {
    return apiRequest<FeedBackfillStatus>(
      "/billing/paid-marks/feed-backfill",
      token,
    );
  },
  recheck(token: string, series: string) {
    return apiRequest<FeedBackfillRecheck>(
      "/billing/paid-marks/feed-backfill/recheck",
      token,
      { method: "POST", body: JSON.stringify({ series }) },
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
