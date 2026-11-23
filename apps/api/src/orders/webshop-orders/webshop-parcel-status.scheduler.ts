import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";

import { WebshopParcelStatusService } from "./webshop-parcel-status.service.js";
import {
  DELIVERED_CODES_ENV,
  describeSyncReport,
  notifyOnClose,
  type ParcelStatusSyncReport,
  type ParcelSyncCarrier,
} from "./webshop-parcel-status-sync.js";

/**
 * THE SCHEDULE OF THE GLS STATUS SYNC (V0.4). The repo's own pattern (`foxpost-settlement.scheduler.ts`,
 * `medusa-projection.scheduler.ts`): a Nest service, a chained `setTimeout`, an unref'd timer, an
 * environment switch and a separate `runOnce`. OFF BY DEFAULT: `GLS_STATUS_SYNC_ENABLED=true`, EXACTLY
 * that. Every six hours by default (four times a day, Balázs 2026-09-02); the interval is bounded.
 *
 * THE FOXPOST PARCEL THE SAME WAY (card ef84489d), with its own switch and timing under the `FOXPOST_` prefix
 * (`FOXPOST_STATUS_SYNC_ENABLED`, `..._INTERVAL_MINUTES`, `..._STARTUP_DELAY_MINUTES`); each carrier runs on its own
 * timer, and one carrier's failure does not stop the other.
 */
const PREFIX: Record<ParcelSyncCarrier, string> = {
  gls: "GLS",
  foxpost: "FOXPOST",
};
export interface GlsStatusSyncConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
}

const boundedMinutes = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(code);
  return parsed;
};

export function parcelStatusSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
  carrier: ParcelSyncCarrier = "gls",
): GlsStatusSyncConfig {
  const p = PREFIX[carrier];
  // the names written out, so the env template guard (env-template-coverage) finds every one of them
  const enabled =
    carrier === "foxpost"
      ? env.FOXPOST_STATUS_SYNC_ENABLED
      : env.GLS_STATUS_SYNC_ENABLED;
  if (enabled !== "true")
    return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedMinutes(
        carrier === "foxpost"
          ? env.FOXPOST_STATUS_SYNC_INTERVAL_MINUTES
          : env.GLS_STATUS_SYNC_INTERVAL_MINUTES,
        360,
        15,
        1440,
        `${p}_STATUS_SYNC_INTERVAL_INVALID`,
      ) * 60_000,
    startupDelayMs:
      boundedMinutes(
        carrier === "foxpost"
          ? env.FOXPOST_STATUS_SYNC_STARTUP_DELAY_MINUTES
          : env.GLS_STATUS_SYNC_STARTUP_DELAY_MINUTES,
        10,
        0,
        240,
        `${p}_STATUS_SYNC_STARTUP_DELAY_INVALID`,
      ) * 60_000,
  };
}

/** The GLS config, as before (`parcelStatusSyncConfig` for GLS). */
export const glsStatusSyncConfig = (
  env: NodeJS.ProcessEnv = process.env,
): GlsStatusSyncConfig => parcelStatusSyncConfig(env, "gls");

/**
 * THE STATUS SYNC, READABLE FROM OUTSIDE (card ef84489d, acrobot 56760): the run's report went only to the application log, which the
 * fleet cannot read on the test API, so "observe mode" had no way to be measured. This is what one carrier's last run left, in memory
 * only (a restart forgets it): counts and the (code, short text, parcels) list the log line carries, no order identifier, name,
 * address or secret. Behind a permission (`GET /health/parcel-status-sync`), like the projection's status.
 */
export interface ParcelSyncCarrierStatus {
  /** the carrier's switch (`FOXPOST_STATUS_SYNC_ENABLED` / `GLS_STATUS_SYNC_ENABLED`) is exactly "true" */
  enabled: boolean;
  /** the switch is on but a setting is invalid: the code of the refusal (the schedule did not start) */
  configError: string | null;
  intervalMinutes: number | null;
  /** when the next run is due (set when it is scheduled); null when not scheduled */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOutcome: "ok" | "error" | null;
  /** the refusal or error code of a failed run, never a message */
  lastErrorCode: string | null;
  /** the delivered codes are configured: empty means observe mode */
  observeMode: boolean;
  lastReport: {
    checked: number;
    closed: number;
    alreadyClosed: number;
    waiting: number;
    /** delivered, but the shop does not offer `closed` from the order's state */
    skipped: number;
    failed: number;
    /** every (code, short text, parcels) the carrier showed; the text only where it repeats on several parcels */
    observed: { code: string; description: string; parcels: number }[];
    configuredCodes: string[];
    notifyCustomer: boolean;
    truncated: boolean;
  } | null;
}

export interface ParcelSyncStatus {
  carriers: Record<ParcelSyncCarrier, ParcelSyncCarrierStatus>;
  /** `PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER` is "true": an automatic closing mails the customer */
  notifyCustomer: boolean;
}

/** How many delivered codes the environment names for the carrier (0: observe mode). */
const deliveredCodesConfigured = (
  env: NodeJS.ProcessEnv,
  carrier: ParcelSyncCarrier,
): number =>
  (env[DELIVERED_CODES_ENV[carrier]] ?? "")
    .split(",")
    .filter((code) => code.trim() !== "").length;

const refusalCode = (error: unknown): string =>
  error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
    ? error.message.slice(0, 120)
    : "RUN_FAILED";

@Injectable()
export class WebshopParcelStatusScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopParcelStatusScheduler.name);
  private readonly timers = new Map<ParcelSyncCarrier, NodeJS.Timeout>();
  private stopped = false;
  private readonly running = new Set<ParcelSyncCarrier>();
  private readonly lastRuns = new Map<
    ParcelSyncCarrier,
    {
      at: Date;
      outcome: "ok" | "error";
      errorCode: string | null;
      report: ParcelStatusSyncReport | null;
    }
  >();
  private readonly nextRuns = new Map<ParcelSyncCarrier, Date>();

  constructor(
    private readonly service: WebshopParcelStatusService,
    @Optional()
    private readonly clock: () => Date = () => new Date(),
  ) {}

  onModuleInit(): void {
    for (const carrier of ["gls", "foxpost"] as const) {
      const config = parcelStatusSyncConfig(process.env, carrier);
      if (config.enabled)
        this.schedule(carrier, config.startupDelayMs, config.intervalMs);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  /**
   * One run of one carrier; a run of that carrier that is still going is not started twice. Returns the log text
   * ("" when nothing to say).
   */
  async runOnce(carrier: ParcelSyncCarrier = "gls"): Promise<string> {
    if (this.running.has(carrier)) return "";
    this.running.add(carrier);
    const at = this.clock();
    try {
      const report = await this.service.run(process.env, at, carrier);
      this.lastRuns.set(carrier, {
        at,
        outcome: "ok",
        errorCode: null,
        report,
      });
      const text = describeSyncReport(report);
      if (text) this.logger.log(text);
      return text;
    } catch (error) {
      this.lastRuns.set(carrier, {
        at,
        outcome: "error",
        errorCode: refusalCode(error),
        report: null,
      });
      throw error;
    } finally {
      this.running.delete(carrier);
    }
  }

  /** What the last run of each carrier left (memory only); counts and codes, no identifier or message. */
  allapot(env: NodeJS.ProcessEnv = process.env): ParcelSyncStatus {
    const one = (carrier: ParcelSyncCarrier): ParcelSyncCarrierStatus => {
      let enabled = false;
      let configError: string | null = null;
      let intervalMinutes: number | null = null;
      try {
        const config = parcelStatusSyncConfig(env, carrier);
        enabled = config.enabled;
        intervalMinutes = config.enabled ? config.intervalMs / 60_000 : null;
      } catch (error) {
        // the switch is on and a setting is invalid: the schedule did not start, and the code names which
        enabled = true;
        configError = refusalCode(error);
      }
      const run = this.lastRuns.get(carrier);
      const next = this.nextRuns.get(carrier);
      const report = run?.report ?? null;
      return {
        enabled,
        configError,
        intervalMinutes,
        nextRunAt: next ? next.toISOString() : null,
        lastRunAt: run ? run.at.toISOString() : null,
        lastOutcome: run?.outcome ?? null,
        lastErrorCode: run?.errorCode ?? null,
        observeMode: deliveredCodesConfigured(env, carrier) === 0,
        lastReport: report
          ? {
              checked: report.checked,
              closed: report.closed.length,
              alreadyClosed: report.alreadyClosed,
              waiting: report.waiting,
              skipped: report.skipped.length,
              failed: report.failed.length,
              observed: report.observed,
              configuredCodes: report.configuredCodes,
              notifyCustomer: report.notifyCustomer,
              truncated: report.truncated,
            }
          : null,
      };
    };
    return {
      carriers: { gls: one("gls"), foxpost: one("foxpost") },
      notifyCustomer: notifyOnClose(env),
    };
  }

  private schedule(
    carrier: ParcelSyncCarrier,
    delayMs: number,
    intervalMs: number,
  ): void {
    this.nextRuns.set(carrier, new Date(this.clock().getTime() + delayMs));
    const timer = setTimeout(() => {
      void this.runOnce(carrier)
        .catch((error) => {
          this.logger.error(
            `Scheduled ${PREFIX[carrier]} status sync failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : `${PREFIX[carrier]}_STATUS_SYNC_FAILED`
            }`,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule(carrier, intervalMs, intervalMs);
        });
    }, delayMs);
    timer.unref();
    this.timers.set(carrier, timer);
  }
}
