import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { WebshopParcelStatusService } from "./webshop-parcel-status.service.js";
import {
  describeSyncReport,
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

@Injectable()
export class WebshopParcelStatusScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopParcelStatusScheduler.name);
  private readonly timers = new Map<ParcelSyncCarrier, NodeJS.Timeout>();
  private stopped = false;
  private readonly running = new Set<ParcelSyncCarrier>();

  constructor(private readonly service: WebshopParcelStatusService) {}

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
    try {
      const text = describeSyncReport(
        await this.service.run(process.env, new Date(), carrier),
      );
      if (text) this.logger.log(text);
      return text;
    } finally {
      this.running.delete(carrier);
    }
  }

  private schedule(
    carrier: ParcelSyncCarrier,
    delayMs: number,
    intervalMs: number,
  ): void {
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
