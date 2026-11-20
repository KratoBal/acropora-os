import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  backfillSummary,
  feedGaps,
  feedSeries,
  foreignSeries,
  NOT_OUR_ACCOUNT,
  SETTLED_OUTCOMES,
  type FeedControlResult,
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
    line: { outcome: string; detail: string };
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
  | { status: "nothing"; phase: "dry" | "apply" }
  /** the control numbers (known to exist) were not found: nothing was asked or recorded, the reason is in `control` */
  | { status: "control-failed"; control: FeedControlResult[] };

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
  /** a legutóbbi száraz kör kontrollja (a feedben lévő legnagyobb számok); `null`, amíg nem futott (újraindulás után is) */
  control: { checkedAt: string; results: FeedControlResult[] } | null;
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
  private control: FeedBackfillStatus["control"] = null;
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
      control: this.control,
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
    if (phase === "dry") {
      // a check that cannot fail proves nothing: ask the numbers that EXIST first, and ask nothing else if they are not found
      let results: FeedControlResult[];
      try {
        results = await this.controlRound(userId, now, true);
      } catch (error) {
        this.running = null;
        throw error;
      }
      // a series the control proved to be outside our account is not a failure: it drops out of the round (and for good)
      if (results.some((r) => !r.passed && !r.foreign)) {
        this.running = null;
        return { status: "control-failed", control: results };
      }
      if (results.some((r) => r.foreign)) {
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
      }
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
    const foreign = foreignSeries(checked);
    return apply
      ? checked.filter((c) => c.outcome === "WOULD_STORE").map((c) => c.number)
      : (await this.gaps(now))
          .filter((g) => !foreign.has(g.series))
          .flatMap((g) => g.missing)
          .filter((n) => !settled.has(n));
  }

  /** One question per payable series: its highest stored number, which the feed holds, so Számlázz.hu has it. */
  private async controlRound(
    userId: string,
    now: Date,
    diagnose = false,
  ): Promise<FeedControlResult[]> {
    const results: FeedControlResult[] = [];
    // a series already judged to be outside our account is not asked again
    const foreign = foreignSeries(await this.store.checked());
    const withGap = (await this.gaps(now)).filter(
      (g) => g.missing.length > 0 && !foreign.has(g.series),
    );
    for (const [i, gap] of withGap.entries()) {
      if (i > 0 && this.delayMs > 0)
        await new Promise((r) => setTimeout(r, this.delayMs));
      let line: FeedPullLine;
      try {
        [line] = (await this.feedPull.pull([gap.highest], false, userId)) as [
          FeedPullLine,
        ];
      } catch (error) {
        line = {
          number: gap.highest,
          outcome: "ERROR",
          detail: `a lekérdezés nem futott le (${error instanceof Error ? error.name : "UNKNOWN"})`,
        };
      }
      const passed = line.outcome === "WOULD_STORE";
      results.push({
        series: gap.series,
        number: gap.highest,
        outcome: line.outcome,
        detail: line.detail,
        passed,
        // a bukott kontroll okát a három olvasó kérdés választja szét (`diagnoseQueryFailure`); a kör végi kontroll nem kérdezi
        ...(!passed && diagnose && typeof this.feedPull.diagnose === "function"
          ? { diagnostics: await this.feedPull.diagnose(gap.highest) }
          : {}),
      });
    }
    if (diagnose) await this.judgeForeignSeries(results, userId);
    this.control = { checkedAt: new Date().toISOString(), results };
    const failed = results.filter((r) => !r.passed && !r.foreign);
    this.logger.log(
      `Feed-visszatöltés kontroll (user ${userId}): ${results.length - failed.length}/${results.length} sorozat rendben${failed
        .map(
          (r) =>
            `; ${r.number} ${r.outcome} ${r.detail}${
              r.diagnostics?.length ? ` [${r.diagnostics.join(" | ")}]` : ""
            }`,
        )
        .join("")}`,
    );
    return results;
  }

  /**
   * A BUKOTT KONTROLL ÍTÉLETE (acrobot 58095): a 7-es válasz (`NOT_FOUND`) két dolgot jelenthet, és egyetlen kérdés választja
   * szét őket: megtalálja-e UGYANEZ a kulcs az OS által kiállított számlát. Ha igen, a kérés alakja és a kulcs jó, a szám pedig
   * nem ebben a fiókban él: a sorozat nem a mi Számlázz.hu fiókunkból való, és VÉGLEGESEN kimarad (`NOT_OUR_ACCOUNT`, a tábla
   * őrzi, újraindítás után is). Ha nem (vagy nem tudni), a bukás marad kontroll-bukás. Egy kör egy kérdést tesz fel, nem
   * sorozatonként egyet.
   */
  private async judgeForeignSeries(
    results: FeedControlResult[],
    userId: string,
  ): Promise<void> {
    const suspects = results.filter(
      (r) => !r.passed && r.outcome === "NOT_FOUND",
    );
    if (
      suspects.length === 0 ||
      typeof this.feedPull.keyKnowsOwnNumber !== "function"
    )
      return;
    if ((await this.feedPull.keyKnowsOwnNumber()) !== true) return;
    for (const result of suspects) {
      result.foreign = true;
      await this.store.record({
        number: result.number,
        series: result.series,
        line: {
          outcome: NOT_OUR_ACCOUNT,
          detail: `a kontroll szám 7-es választ kapott, az OS által kiállított számlát ugyanez a kulcs megtalálta: ${result.detail}`,
        },
        userId,
        at: new Date(),
      });
    }
    this.logger.log(
      `Feed-visszatöltés: ${suspects.map((r) => r.series).join(", ")} nem a mi Számlázz.hu fiókunkból való, a sorozat kimarad`,
    );
  }

  private async loop(
    phase: "dry" | "apply",
    numbers: readonly string[],
    userId: string,
  ): Promise<void> {
    const outcomes: Record<string, number> = {};
    const noes: { number: string; series: string; detail: string }[] = [];
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
        const series = feedSeries(number) ?? "?";
        // the BEHÚZÁS round runs no control: a 7 there is no proof of an unknown number, so it is not a final no
        const recorded =
          phase === "apply" && line.outcome === "NOT_FOUND"
            ? {
                outcome: "UNVERIFIED",
                detail: `ellenőrzésre vár: a behúzó kör kontroll nélkül kapta (${line.detail})`,
              }
            : line;
        await this.store.record({
          number,
          series,
          line: recorded,
          userId,
          at: new Date(),
        });
        if (phase === "dry" && line.outcome === "NOT_FOUND")
          noes.push({ number, series, detail: line.detail });
        outcomes[recorded.outcome] = (outcomes[recorded.outcome] ?? 0) + 1;
        this.running!.done = i + 1;
      }
      if (noes.length > 0) await this.revokeNoesIfBroken(noes, userId);
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
  /**
   * The control measures the question's soundness at the start of the round, not during it. A key change or a fault on
   * the Számlázz.hu side in the middle would still answer 7 and leave final noes. So the control is asked once more at
   * the end, and if it fails, this round's noes lose their finality (UNVERIFIED) and the failure shows on the page.
   */
  private async revokeNoesIfBroken(
    noes: readonly { number: string; series: string; detail: string }[],
    userId: string,
  ): Promise<void> {
    const results = await this.controlRound(userId, new Date());
    if (results.every((r) => r.passed)) return;
    for (const no of noes)
      await this.store.record({
        number: no.number,
        series: no.series,
        line: {
          outcome: "UNVERIFIED",
          detail: `ellenőrzésre vár: a kör végi kontroll nem sikerült (${no.detail})`,
        },
        userId,
        at: new Date(),
      });
    this.logger.warn(
      `Feed-visszatöltés: a kör végi kontroll nem sikerült, ${noes.length} nem ellenőrzésre vár lett`,
    );
  }
}
