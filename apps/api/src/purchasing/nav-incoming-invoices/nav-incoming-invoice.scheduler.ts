import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";

export interface NavInvoiceSyncScheduleConfig {
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

// 15 perces alapértelmezett gyakoriság, mint a UNAS vevő-szinkronnál - a
// belföldi bejövő számlák NAV-oldali regisztrálása sem valós idejű, nincs
// értelme ennél gyakrabban lekérdezni.
export function navInvoiceSyncScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): NavInvoiceSyncScheduleConfig {
  const enabled = environment.NAV_INVOICE_SYNC_ENABLED === "true";
  if (!enabled) return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  const intervalMinutes = boundedInteger(
    environment.NAV_INVOICE_SYNC_INTERVAL_MINUTES,
    15,
    1,
    1440,
    "INVALID_NAV_INVOICE_SYNC_INTERVAL_MINUTES",
  );
  const startupDelaySeconds = boundedInteger(
    environment.NAV_INVOICE_SYNC_STARTUP_DELAY_SECONDS,
    30,
    0,
    3600,
    "INVALID_NAV_INVOICE_SYNC_STARTUP_DELAY_SECONDS",
  );
  return {
    enabled,
    intervalMs: intervalMinutes * 60_000,
    startupDelayMs: startupDelaySeconds * 1000,
  };
}

@Injectable()
export class NavIncomingInvoiceScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NavIncomingInvoiceScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: NavIncomingInvoiceService) {}

  onModuleInit() {
    const config = navInvoiceSyncScheduleConfig();
    if (!config.enabled) return;
    this.logger.log(
      `NAV invoice sync scheduler enabled (${config.intervalMs / 60_000} min)`,
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
      await this.sync.sync();
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "NAV_INVOICE_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("NAV invoice sync skipped: another run is active");
        return "SKIPPED";
      }
      const errorCode =
        error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message.slice(0, 200)
          : "NAV_INVOICE_SYNC_SCHEDULED_FAILED";
      this.logger.error(`Scheduled NAV invoice sync failed: ${errorCode}`);
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
