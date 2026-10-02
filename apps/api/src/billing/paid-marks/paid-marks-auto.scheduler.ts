import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { prismaPaymentMarkStore } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { PaymentMarkSource } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import { HttpSzamlazzAgentClient } from "../../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzCredentialProvider } from "../../integrations/szamlazz/szamlazz-credential.provider.js";
import {
  paidMarksMode,
  paidMarksRunLine,
  runPaidMarksAuto,
  type PaidMarkPlan,
  type PaidMarksMode,
} from "./paid-marks-auto.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";
import {
  foxpostPaidMarkPlan,
  glsPaidMarkPlan,
  simplePayPaidMarkPlan,
} from "./paid-marks-sources.js";

/** The sources, their switches and their dry-run plans. */
export const PAID_MARK_SOURCES: readonly {
  source: PaymentMarkSource;
  switchName: string;
  plan: (from: string) => Promise<PaidMarkPlan>;
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
  return modes.some((m) => m.mode === "auto")
    ? `Kifizetett-jelölés automatikusan: naponta ${hour}:00-kor, ${days} napra vissza (${list})`
    : `Kifizetett-jelölés automatikusan: KI, egyik forrás sincs auto állásban (${list})`;
}

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

  constructor(
    private readonly credentials: SzamlazzCredentialProvider,
    private readonly runs: PaidMarkRunRepository,
  ) {}

  private autoSources() {
    return PAID_MARK_SOURCES.filter(
      (s) => paidMarksMode(process.env[s.switchName]) === "auto",
    );
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
    if (this.autoSources().length === 0) return;
    this.schedule(hour);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** `sources` only for the test; by default the ones on `auto`. */
  async runOnce(
    now = new Date(),
    sources: readonly (typeof PAID_MARK_SOURCES)[number][] = this.autoSources(),
  ): Promise<void> {
    if (sources.length === 0) return;
    let agentKey: string;
    try {
      agentKey = (await this.credentials.resolve()).agentKey;
    } catch (error) {
      const code = errorCode(error, "SZAMLAZZ_CREDENTIAL_UNAVAILABLE");
      this.logger.error(
        `Kifizetett-jelölés: nincs Számlázz.hu-kulcs (${code}), semmi nem futott`,
      );
      for (const s of sources) await this.runs.saveFailed(s.source, code);
      return;
    }
    const from = runFrom(now, paidMarksAutoDays());
    const client = new HttpSzamlazzAgentClient();
    for (const s of sources) {
      try {
        const result = await runPaidMarksAuto({
          plan: await s.plan(from),
          agentKey,
          client,
          store: prismaPaymentMarkStore,
        });
        await this.runs.save(result);
        this.logger.log(paidMarksRunLine(result));
      } catch (error) {
        const code = errorCode(error, "PAID_MARKS_AUTO_FAILED");
        this.logger.error(
          `Kifizetett-jelölés ${s.source}: a futás elbukott (${code})`,
        );
        await this.runs.saveFailed(s.source, code);
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
