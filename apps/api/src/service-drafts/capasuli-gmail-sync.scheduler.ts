import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  capasuliConfig,
  describeCapasuliSync,
} from "./capasuli-gmail.config.js";
import { ServiceDraftsService } from "./service-drafts.service.js";

const STARTUP_DELAY_MS = 90_000;

/**
 * Runs the Cápasuli Gmail pull on a timer when it is on, and says so in ONE log
 * line at start either way: the Foxpost pull's silence while off is what hid
 * seven weeks of not running.
 */
@Injectable()
export class CapasuliGmailSyncScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CapasuliGmailSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: ServiceDraftsService) {}

  onModuleInit(): void {
    const c = capasuliConfig();
    const intervalMinutes = c.intervalMinutes;
    this.logger.log(describeCapasuliSync(c));
    if (!c.enabled) return;
    this.schedule(STARTUP_DELAY_MS, intervalMinutes * 60_000);
  }

  onModuleDestroy(): void {
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
        error.message === "CAPASULI_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("Cápasuli Gmail sync skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled Cápasuli Gmail sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "CAPASULI_SYNC_SCHEDULED_FAILED"
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
