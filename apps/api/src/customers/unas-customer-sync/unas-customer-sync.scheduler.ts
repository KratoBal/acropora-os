import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";

export interface UnasCustomerSyncScheduleConfig {
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

// Same 15-minute default as the product sync: customer master data changes
// far less often than orders, so there's no need for the order sync's
// tighter 5-minute cadence.
export function unasCustomerSyncScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UnasCustomerSyncScheduleConfig {
  const enabled = environment.UNAS_CUSTOMER_SYNC_ENABLED === "true";
  if (!enabled) return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  const intervalMinutes = boundedInteger(
    environment.UNAS_CUSTOMER_SYNC_INTERVAL_MINUTES,
    15,
    1,
    1440,
    "INVALID_UNAS_CUSTOMER_SYNC_INTERVAL_MINUTES",
  );
  const startupDelaySeconds = boundedInteger(
    environment.UNAS_CUSTOMER_SYNC_STARTUP_DELAY_SECONDS,
    30,
    0,
    3600,
    "INVALID_UNAS_CUSTOMER_SYNC_STARTUP_DELAY_SECONDS",
  );
  return {
    enabled,
    intervalMs: intervalMinutes * 60_000,
    startupDelayMs: startupDelaySeconds * 1000,
  };
}

@Injectable()
export class UnasCustomerSyncScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UnasCustomerSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasCustomerSyncService,
  ) {}

  onModuleInit() {
    const config = unasCustomerSyncScheduleConfig();
    if (!config.enabled) return;
    this.logger.log(
      `UNAS customer sync scheduler enabled (${config.intervalMs / 60_000} min)`,
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
        error.message === "UNAS_CUSTOMER_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("UNAS customer sync skipped: another run is active");
        return "SKIPPED";
      }
      const errorCode =
        error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message.slice(0, 200)
          : "UNAS_CUSTOMER_SYNC_SCHEDULED_FAILED";
      this.logger.error(`Scheduled UNAS customer sync failed: ${errorCode}`);
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
