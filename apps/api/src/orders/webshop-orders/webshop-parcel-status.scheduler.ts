import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { WebshopParcelStatusService } from "./webshop-parcel-status.service.js";
import { describeSyncReport } from "./webshop-parcel-status-sync.js";

/**
 * THE SCHEDULE OF THE GLS STATUS SYNC (V0.4). The repo's own pattern (`foxpost-settlement.scheduler.ts`,
 * `medusa-projection.scheduler.ts`): a Nest service, a chained `setTimeout`, an unref'd timer, an
 * environment switch and a separate `runOnce`. OFF BY DEFAULT: `GLS_STATUS_SYNC_ENABLED=true`, EXACTLY
 * that. Every six hours by default (four times a day, Balázs 2026-09-02); the interval is bounded.
 */
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

export function glsStatusSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
): GlsStatusSyncConfig {
  if (env.GLS_STATUS_SYNC_ENABLED !== "true")
    return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedMinutes(
        env.GLS_STATUS_SYNC_INTERVAL_MINUTES,
        360,
        15,
        1440,
        "GLS_STATUS_SYNC_INTERVAL_INVALID",
      ) * 60_000,
    startupDelayMs:
      boundedMinutes(
        env.GLS_STATUS_SYNC_STARTUP_DELAY_MINUTES,
        10,
        0,
        240,
        "GLS_STATUS_SYNC_STARTUP_DELAY_INVALID",
      ) * 60_000,
  };
}

@Injectable()
export class WebshopParcelStatusScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopParcelStatusScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(private readonly service: WebshopParcelStatusService) {}

  onModuleInit(): void {
    const config = glsStatusSyncConfig();
    if (!config.enabled) return;
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One run; a run that is still going is not started twice. Returns the log text ("" when nothing to say). */
  async runOnce(): Promise<string> {
    if (this.running) return "";
    this.running = true;
    try {
      const text = describeSyncReport(await this.service.run());
      if (text) this.logger.log(text);
      return text;
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error) => {
          this.logger.error(
            `Scheduled GLS status sync failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : "GLS_STATUS_SYNC_FAILED"
            }`,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule(intervalMs, intervalMs);
        });
    }, delayMs);
    this.timer.unref();
  }
}
