import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";

export interface UnasSyncScheduleConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  errorCode: string,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(errorCode);
  return parsed;
}

export function unasSyncScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UnasSyncScheduleConfig {
  const enabled = environment.UNAS_PRODUCT_SYNC_ENABLED === "true";
  if (!enabled) return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  const intervalMinutes = boundedInteger(
    environment.UNAS_PRODUCT_SYNC_INTERVAL_MINUTES,
    15,
    5,
    1440,
    "INVALID_UNAS_PRODUCT_SYNC_INTERVAL_MINUTES",
  );
  const startupDelaySeconds = boundedInteger(
    environment.UNAS_PRODUCT_SYNC_STARTUP_DELAY_SECONDS,
    30,
    0,
    3600,
    "INVALID_UNAS_PRODUCT_SYNC_STARTUP_DELAY_SECONDS",
  );
  return {
    enabled,
    intervalMs: intervalMinutes * 60_000,
    startupDelayMs: startupDelaySeconds * 1000,
  };
}

@Injectable()
export class UnasProductSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnasProductSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasProductSyncService,
  ) {}

  onModuleInit() {
    const config = unasSyncScheduleConfig();
    if (!config.enabled) return;
    this.logger.log(
      `UNAS product sync scheduler enabled (${config.intervalMs / 60_000} min)`,
    );
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      const token = await this.auth.getToken();
      await this.sync.runIncremental(token);
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "UNAS_PRODUCT_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("UNAS product sync skipped: another run is active");
        return "SKIPPED";
      }
      const errorCode =
        error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message.slice(0, 200)
          : "UNAS_PRODUCT_SYNC_SCHEDULED_FAILED";
      this.logger.error(`Scheduled UNAS product sync failed: ${errorCode}`);
      return "FAILED";
    }
  }

  private schedule(delayMs: number, intervalMs: number) {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(intervalMs, intervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }
}
