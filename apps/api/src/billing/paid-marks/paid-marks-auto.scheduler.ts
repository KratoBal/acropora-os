import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { prismaPaymentMarkStore } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type {
  PaymentMarkSource,
  PaymentMarkStore,
} from "../../integrations/szamlazz/outgoing-payment-marks.js";
import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPaymentClient,
} from "../../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzCredentialProvider } from "../../integrations/szamlazz/szamlazz-credential.provider.js";
import {
  paidMarksDryResult,
  paidMarksMode,
  paidMarksRunLine,
  runPaidMarksAuto,
  type PaidMarkPlan,
  type PaidMarksMode,
  type PaidMarksRunResult,
} from "./paid-marks-auto.js";
import {
  PaidMarkRunRepository,
  type PaidMarkTrigger,
} from "./paid-mark-run.repository.js";
import {
  foxpostPaidMarkPlan,
  glsPaidMarkPlan,
  simplePayPaidMarkPlan,
} from "./paid-marks-sources.js";
import {
  bankTransferPaidMarkPlan,
  runBankTransferMarks,
} from "../bank-transfer-paid-marks.js";

/** The sources, their switches and their dry-run plans. */
export const PAID_MARK_SOURCES: readonly {
  source: PaymentMarkSource;
  switchName: string;
  plan: (from: string) => Promise<PaidMarkPlan>;
  /** a source that writes its own way (one bank credit under its lock, #2192); else the shared writer */
  run?: (
    from: string,
    context: {
      agentKey: string;
      client: SzamlazzAgentPaymentClient;
      store: PaymentMarkStore;
    },
  ) => Promise<PaidMarksRunResult>;
}[] = [
  { source: "GLS_COD", switchName: "GLS_COD_MARK_PAID", plan: glsPaidMarkPlan },
  {
    source: "FOXPOST",
    switchName: "FOXPOST_MARK_PAID",
    plan: foxpostPaidMarkPlan,
  },
  {
    source: "SIMPLEPAY",
    switchName: "SIMPLEPAY_MARK_PAID",
    plan: simplePayPaidMarkPlan,
  },
  // one transfer, several of our invoices (card aeddb2c3): automatic only on one customer and an exact amount
  {
    source: "BANK_TRANSFER",
    switchName: "BANK_TRANSFER_MARK_PAID",
    plan: bankTransferPaidMarkPlan,
    run: runBankTransferMarks,
  },
];

const bounded = (
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** The hour of the daily run, local time (Europe/Budapest); default 7. */
export const paidMarksAutoHour = (env: NodeJS.ProcessEnv = process.env) =>
  bounded(env.PAID_MARKS_AUTO_HOUR, 0, 23, 7);

/** How many days back a run looks; the log keeps it idempotent. Default 60. */
export const paidMarksAutoDays = (env: NodeJS.ProcessEnv = process.env) =>
  bounded(env.PAID_MARKS_AUTO_DAYS, 7, 400, 60);

/** Milliseconds from `now` to the next `hour`:00 local time (today or tomorrow). */
export function msUntilNextRun(now: Date, hour: number): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** The first day a run looks at: `days` before `now`, as YYYY-MM-DD. */
export function runFrom(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The one start-up line, whether or not anything runs. */
export function describePaidMarksAuto(
  modes: readonly { source: PaymentMarkSource; mode: PaidMarksMode }[],
  hour: number,
  days: number,
): string {
  const list = modes.map((m) => `${m.source}=${m.mode}`).join(", ");
  return modes.some((m) => m.mode === "auto" || m.mode === "dry")
    ? `Kifizetett-jelölés automatikusan: naponta ${hour}:00-kor, ${days} napra vissza (${list})`
    : `Kifizetett-jelölés automatikusan: KI, egyik forrás sincs auto vagy dry állásban (${list})`;
}

/** What a "Futtatás most" press answers (e64540fd). */
export type PaidMarksRunNow =
  | {
      status: "started";
      sources: { source: PaymentMarkSource; mode: PaidMarksMode }[];
    }
  | { status: "running" }
  | { status: "nothing"; reason: "no-source-on-auto-or-dry" };

/**
 * THE DAILY RUN (acrobot 26101): every source on `auto` writes its markable
 * invoices through the shared loop, one summary row and one log line each.
 * The Számlázz.hu key is resolved FIRST: without it nothing is planned or
 * logged, and every auto source gets a run row with the error.
 */
@Injectable()
export class PaidMarksAutoScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaidMarksAutoScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /**
   * THE ONE LOCK OF A RUN, the daily one and the manual one alike (e64540fd): while a run is in flight
   * a second one does not start, so two runs never plan and write the same invoices at once. The API
   * runs as one process (one container per environment); the writer's own guards (PLANNED before the
   * call, no blind retry, the bank credit's lock) stay under it as before.
   */
  private running: { startedAt: Date; done: Promise<void> } | null = null;

  constructor(
    private readonly credentials: SzamlazzCredentialProvider,
    private readonly runs: PaidMarkRunRepository,
  ) {}

  /** The sources a run takes: `auto` writes, `dry` records the plan only (e64540fd). */
  private runSources() {
    return PAID_MARK_SOURCES.filter((s) => {
      const mode = paidMarksMode(process.env[s.switchName]);
      return mode === "auto" || mode === "dry";
    });
  }

  /** Each source and its switch, for the page. */
  modes(): { source: PaymentMarkSource; mode: PaidMarksMode }[] {
    return PAID_MARK_SOURCES.map((s) => ({
      source: s.source,
      mode: paidMarksMode(process.env[s.switchName]),
    }));
  }

  /** Whether a run is in flight, and since when. */
  status(): { running: boolean; startedAt: string | null } {
    return {
      running: this.running !== null,
      startedAt: this.running?.startedAt.toISOString() ?? null,
    };
  }

  /**
   * "FUTTATÁS MOST" (Balázs, 2026-11-05 08:14 UTC; e64540fd): the daily run, started by hand, with the
   * same code and the same switches. It does not wait for the run: the answer says it started, and the
   * page reads the outcome from `latest`.
   */
  runNow(userId: string, now = new Date()): PaidMarksRunNow {
    const sources = this.runSources();
    if (sources.length === 0)
      return { status: "nothing", reason: "no-source-on-auto-or-dry" };
    if (this.running) return { status: "running" };
    void this.runOnce(now, sources, { kind: "manual", userId }).catch(
      (error: unknown) =>
        this.logger.error(
          `Kifizetett-jelölés (kézi): a futás váratlanul elbukott (${errorCode(error, "PAID_MARKS_RUN_FAILED")})`,
        ),
    );
    return {
      status: "started",
      sources: sources.map((s) => ({
        source: s.source,
        mode: paidMarksMode(process.env[s.switchName]),
      })),
    };
  }

  onModuleInit(): void {
    const hour = paidMarksAutoHour();
    this.logger.log(
      describePaidMarksAuto(
        PAID_MARK_SOURCES.map((s) => ({
          source: s.source,
          mode: paidMarksMode(process.env[s.switchName]),
        })),
        hour,
        paidMarksAutoDays(),
      ),
    );
    if (this.runSources().length === 0) return;
    this.schedule(hour);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * `sources` only for the test; by default the ones on `auto` or `dry`. A run already in flight is not
   * doubled: the call returns without running (the daily timer's next turn comes the next day).
   */
  async runOnce(
    now = new Date(),
    sources: readonly (typeof PAID_MARK_SOURCES)[number][] = this.runSources(),
    trigger: PaidMarkTrigger = { kind: "schedule" },
  ): Promise<void> {
    if (sources.length === 0) return;
    if (this.running) {
      this.logger.warn(
        `Kifizetett-jelölés: egy futás már tart (${this.running.startedAt.toISOString()} óta), ez nem indult`,
      );
      return;
    }
    const done = this.runSourcesOnce(now, sources, trigger);
    this.running = { startedAt: now, done };
    try {
      await done;
    } finally {
      this.running = null;
    }
  }

  private async runSourcesOnce(
    now: Date,
    sources: readonly (typeof PAID_MARK_SOURCES)[number][],
    trigger: PaidMarkTrigger,
  ): Promise<void> {
    const from = runFrom(now, paidMarksAutoDays());
    const mode = (s: (typeof PAID_MARK_SOURCES)[number]) =>
      paidMarksMode(process.env[s.switchName]);

    // a dry source only plans: it needs no Számlázz.hu key, and it never writes
    for (const s of sources.filter((x) => mode(x) === "dry")) {
      try {
        const { result, planned } = paidMarksDryResult(await s.plan(from));
        await this.runs.saveDry(result, planned, trigger);
        this.logger.log(
          `Kifizetett-jelölés ${s.source} (dry): kifizetettre jelölne ${planned.length}; figyelmet kér ${result.attention.length}`,
        );
      } catch (error) {
        const code = errorCode(error, "PAID_MARKS_DRY_FAILED");
        this.logger.error(
          `Kifizetett-jelölés ${s.source} (dry): a terv elbukott (${code})`,
        );
        await this.runs.saveFailed(s.source, code, trigger, "dry");
      }
    }

    // the rest writes: by default only the `auto` ones are here (a test hands its sources in directly)
    const writing = sources.filter((x) => mode(x) !== "dry");
    if (writing.length === 0) return;
    let agentKey: string;
    try {
      agentKey = (await this.credentials.resolve()).agentKey;
    } catch (error) {
      const code = errorCode(error, "SZAMLAZZ_CREDENTIAL_UNAVAILABLE");
      this.logger.error(
        `Kifizetett-jelölés: nincs Számlázz.hu-kulcs (${code}), semmi nem futott`,
      );
      for (const s of writing)
        await this.runs.saveFailed(s.source, code, trigger);
      return;
    }
    const client = new HttpSzamlazzAgentClient();
    for (const s of writing) {
      try {
        const result = s.run
          ? await s.run(from, {
              agentKey,
              client,
              store: prismaPaymentMarkStore,
            })
          : await runPaidMarksAuto({
              plan: await s.plan(from),
              agentKey,
              client,
              store: prismaPaymentMarkStore,
            });
        await this.runs.save(result, trigger);
        this.logger.log(paidMarksRunLine(result));
      } catch (error) {
        const code = errorCode(error, "PAID_MARKS_AUTO_FAILED");
        this.logger.error(
          `Kifizetett-jelölés ${s.source}: a futás elbukott (${code})`,
        );
        await this.runs.saveFailed(s.source, code, trigger);
      }
    }
  }

  private schedule(hour: number): void {
    this.timer = setTimeout(
      () => {
        void this.runOnce().finally(() => {
          if (!this.stopped) this.schedule(hour);
        });
      },
      msUntilNextRun(new Date(), hour),
    );
    this.timer.unref();
  }
}

function errorCode(error: unknown, fallback: string): string {
  const name =
    (error as { code?: unknown })?.code ??
    (error instanceof Error ? error.message : undefined);
  return typeof name === "string" && /^[A-Z0-9_:.-]+$/.test(name)
    ? name
    : fallback;
}
