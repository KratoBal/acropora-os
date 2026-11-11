import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";
import {
  AUTOMATIC_MAX_TO_FALSE,
  UnasWebshopSellableReconciler,
} from "./unas-webshop-sellable-reconcile.js";

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
    private readonly sellable: UnasWebshopSellableReconciler,
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
      await this.reconcileSellable();
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

  /**
   * THE STORED `webshopSellable` IS RECOMPUTED AFTER EVERY SYNC (card e1de003d; the reasons and the
   * guards are in `unas-webshop-sellable-reconcile.ts`). It never fails the sync run: the sync itself
   * succeeded, and a failure here is logged loudly instead of turning a good run red.
   */
  private async reconcileSellable() {
    try {
      const result = await this.sellable.run({
        apply: true,
        maxToFalse: AUTOMATIC_MAX_TO_FALSE,
      });
      if (result.mode === "held")
        this.logger.error(
          `webshopSellable reconcile held: ${result.heldReason}`,
        );
      else if (result.toTrue + result.toFalse > 0)
        this.logger.log(
          `webshopSellable reconciled: ${result.toTrue} to sellable, ${result.toFalse} to not sellable (${result.skippedNoBaseStatus} skipped, no base status)`,
        );
    } catch (error) {
      this.logger.error(
        `webshopSellable reconcile failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
      );
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
