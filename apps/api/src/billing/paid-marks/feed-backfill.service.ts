import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  backfillSummary,
  feedGaps,
  feedSeries,
  SETTLED_OUTCOMES,
  type FeedGapSeries,
} from "../feed-backfill.js";
import type { FeedPullLine } from "../feed-pull.js";
import { FeedPullService } from "./feed-pull.service.js";

/** A tárolt számla száma és fajtája, a hézagokhoz; a teszt cseréli. */
export interface FeedBackfillStore {
  storedNumbers(
    year: number,
  ): Promise<{ documentNumber: string; kindCode: string }[]>;
  checked(): Promise<{ number: string; series: string; outcome: string }[]>;
  record(input: {
    number: string;
    series: string;
    line: FeedPullLine;
    userId: string;
    at: Date;
  }): Promise<void>;
}

export const prismaFeedBackfillStore: FeedBackfillStore = {
  storedNumbers: (year) =>
    prisma.externalBillingDocument.findMany({
      where: { source: "SZAMLAZZ", documentNumber: { contains: `${year}/` } },
      select: { documentNumber: true, kindCode: true },
    }),
  checked: () =>
    prisma.szamlazzFeedBackfillNumber.findMany({
      select: { number: true, series: true, outcome: true },
    }),
  async record({ number, series, line, userId, at }) {
    const data = {
      series,
      outcome: line.outcome,
      detail: line.detail,
      checkedAt: at,
      checkedById: userId,
      ...(line.outcome === "STORED" ? { storedAt: at } : {}),
    };
    await prisma.szamlazzFeedBackfillNumber.upsert({
      where: { number },
      create: { number, ...data },
      update: data,
    });
  },
};

export type FeedBackfillStart =
  | { status: "started"; phase: "dry" | "apply"; total: number }
  | { status: "running" }
  | { status: "nothing"; phase: "dry" | "apply" };

/** Ahogy a lap látja: fut-e, hol tart, sorozatonként a hézag és a Számlázz.hu válaszai. */
export interface FeedBackfillStatus {
  running: {
    phase: "dry" | "apply";
    startedAt: string;
    done: number;
    total: number;
  } | null;
  /** az utolsó befejezett kör */
  last: {
    phase: "dry" | "apply";
    finishedAt: string;
    done: number;
  } | null;
  year: number;
  series: { series: string; highest: string; missing: number }[];
  /** sorozatonként kimenetenként: WOULD_STORE, STORED, NOT_FOUND, ERROR, ... */
  checked: Record<string, Record<string, number>>;
}

/** Két Agent-lekérdezés között ennyi szünet (FEED_BACKFILL_DELAY_MS, alapból 1000 ms): egyszeri, lassított kör. */
export const feedBackfillDelayMs = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.FEED_BACKFILL_DELAY_MS);
  return Number.isInteger(n) && n >= 0 && n <= 60_000 ? n : 1000;
};

/**
 * A VISSZATÖLTÉS FUTTATÓJA (6fd8c574; acrobot 43766, 43768, 43776). Élesen nincs shell: a Napi jelölés lapjáról indul,
 * `BILLING_ISSUE` joggal, a "Lekérés a Számlázz.hu-ból" útján, számonként (`FeedPullService.pull`, ami minden számot
 * naplóz: ki kérte, mi lett).
 *
 * KÉT KÖR. A SZÁRAZ minden hiányzó számot megkérdez (a Számlázz.hu-n csak olvasás), és a választ eltárolja; a lap
 * sorozatonként mutatja, hányat ismer (az ACRW sorozat külön, acrobot 43768). A BEHÚZÁS csak a WOULD_STORE számokat
 * húzza be (ugyanaz az idempotens tárolás: másodszor SEEN). A régi jóváírások párosítása (a kifizetett-jelölés korhatár
 * nélkül, acrobot 43776) NEM indul magától: a lapon előbb a száraz előnézete látszik, és külön gomb írja (acrobot 43822).
 *
 * FOLYTATHATÓ: a végleges választ adó számot (ismeri, nem ismeri, behúzva) a következő száraz kör nem kérdezi újra; a
 * hibás válasz újra megy. Egyszerre egy kör fut (egy folyamat), a lekérdezések között szünet van.
 */
@Injectable()
export class FeedBackfillService {
  private readonly logger = new Logger(FeedBackfillService.name);
  private running: FeedBackfillStatus["running"] = null;
  private last: FeedBackfillStatus["last"] = null;
  /** a teszt cseréli */
  store: FeedBackfillStore = prismaFeedBackfillStore;
  delayMs = feedBackfillDelayMs();
  private current: Promise<void> | null = null;

  constructor(private readonly feedPull: FeedPullService) {}

  private async gaps(now: Date): Promise<FeedGapSeries[]> {
    const year = now.getFullYear();
    return feedGaps(await this.store.storedNumbers(year), year);
  }

  async status(now = new Date()): Promise<FeedBackfillStatus> {
    const gaps = await this.gaps(now);
    return {
      running: this.running,
      last: this.last,
      year: now.getFullYear(),
      series: gaps.map((g) => ({
        series: g.series,
        highest: g.highest,
        missing: g.missing.length,
      })),
      checked: backfillSummary(await this.store.checked()),
    };
  }

  /** A behúzás után, a teszté: megvárja a kört. */
  settled(): Promise<void> {
    return this.current ?? Promise.resolve();
  }

  async start(
    apply: boolean,
    userId: string,
    now = new Date(),
  ): Promise<FeedBackfillStart> {
    const phase = apply ? "apply" : "dry";
    if (this.running) return { status: "running" };
    // the slot is taken before the first await: two presses never start two loops
    this.running = { phase, startedAt: now.toISOString(), done: 0, total: 0 };
    let targets: string[];
    try {
      targets = await this.targets(apply, now);
    } catch (error) {
      this.running = null;
      throw error;
    }
    if (targets.length === 0) {
      this.running = null;
      return { status: "nothing", phase };
    }
    this.running.total = targets.length;
    this.current = this.loop(phase, targets, userId).catch((error: unknown) =>
      this.logger.error(
        `Feed-visszatöltés (${phase}): váratlanul megállt (${error instanceof Error ? error.name : "UNKNOWN"})`,
      ),
    );
    return { status: "started", phase, total: targets.length };
  }

  /** dry: every gap not answered for good yet; apply: what Számlázz.hu said it has */
  private async targets(apply: boolean, now: Date): Promise<string[]> {
    const checked = await this.store.checked();
    const settled = new Set(
      checked
        .filter((c) => SETTLED_OUTCOMES.has(c.outcome))
        .map((c) => c.number),
    );
    return apply
      ? checked.filter((c) => c.outcome === "WOULD_STORE").map((c) => c.number)
      : (await this.gaps(now))
          .flatMap((g) => g.missing)
          .filter((n) => !settled.has(n));
  }

  private async loop(
    phase: "dry" | "apply",
    numbers: readonly string[],
    userId: string,
  ): Promise<void> {
    const outcomes: Record<string, number> = {};
    try {
      for (const [i, number] of numbers.entries()) {
        if (i > 0 && this.delayMs > 0)
          await new Promise((r) => setTimeout(r, this.delayMs));
        let line: FeedPullLine;
        try {
          [line] = (await this.feedPull.pull(
            [number],
            phase === "apply",
            userId,
          )) as [FeedPullLine];
        } catch (error) {
          line = {
            number,
            outcome: "ERROR",
            detail: `a lekérdezés nem futott le (${error instanceof Error ? error.name : "UNKNOWN"})`,
          };
        }
        await this.store.record({
          number,
          series: feedSeries(number) ?? "?",
          line,
          userId,
          at: new Date(),
        });
        outcomes[line.outcome] = (outcomes[line.outcome] ?? 0) + 1;
        this.running!.done = i + 1;
      }
      this.logger.log(
        `Feed-visszatöltés ${phase === "apply" ? "BEHÚZÁS" : "száraz"} (user ${userId}): ${numbers.length} szám, ${Object.entries(
          outcomes,
        )
          .map(([k, n]) => `${k} ${n}`)
          .join(", ")}`,
      );
    } finally {
      const done = this.running?.done ?? 0;
      this.running = null;
      this.last = {
        phase,
        finishedAt: new Date().toISOString(),
        done,
      };
    }
  }
}
