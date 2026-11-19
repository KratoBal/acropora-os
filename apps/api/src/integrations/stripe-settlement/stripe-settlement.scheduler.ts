import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  describeStripeSyncState,
  stripeSyncIntervalMinutes,
  stripeSyncState,
} from "./stripe-settlement.config.js";
import { StripeSettlementService } from "./stripe-settlement.service.js";

const STARTUP_DELAY_MS = 120_000;

/**
 * Runs the Stripe settlement pull on a timer when it is on, and says so in ONE log line at start either way (the SimplePay
 * scheduler's rule: a pull that is silently off hides weeks of not running).
 */
@Injectable()
export class StripeSettlementScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StripeSettlementScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: StripeSettlementService) {}

  onModuleInit(): void {
    const state = stripeSyncState();
    const intervalMinutes = stripeSyncIntervalMinutes();
    this.logger.log(describeStripeSyncState(state, intervalMinutes));
    if (state !== "ENABLED") return;
    this.schedule(STARTUP_DELAY_MS, intervalMinutes * 60_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      await this.sync.sync("SCHEDULED");
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "STRIPE_SETTLEMENT_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log(
          "Stripe settlement sync skipped: another run is active",
        );
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled Stripe settlement sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "STRIPE_SETTLEMENT_SYNC_SCHEDULED_FAILED"
        }`,
      );
      return "FAILED";
    }
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(intervalMs, intervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }
}
