import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  describeSimplePaySyncState,
  simplePayGmailCredentials,
  simplePaySyncIntervalMinutes,
  simplePaySyncSwitch,
} from "./simplepay-gmail.config.js";
import { SimplePayGmailSyncService } from "./simplepay-gmail-sync.service.js";

const STARTUP_DELAY_MS = 120_000;

/**
 * Runs the SimplePay Gmail pull on a timer when it is on, and says so in ONE
 * log line at start either way (the Foxpost pull's silence while off hid
 * seven weeks of not running; the GLS scheduler's rule).
 */
@Injectable()
export class SimplePayGmailSyncScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SimplePayGmailSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: SimplePayGmailSyncService) {}

  onModuleInit(): void {
    const switchState = simplePaySyncSwitch(
      process.env.GMAIL_SIMPLEPAY_SYNC_ENABLED,
    );
    const credentials = simplePayGmailCredentials();
    const intervalMinutes = simplePaySyncIntervalMinutes();
    this.logger.log(
      describeSimplePaySyncState(switchState, credentials, intervalMinutes),
    );
    if (!switchState.on || !credentials) return;
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
        error.message === "SIMPLEPAY_GMAIL_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("SimplePay Gmail sync skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled SimplePay Gmail sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "SIMPLEPAY_GMAIL_SYNC_SCHEDULED_FAILED"
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
