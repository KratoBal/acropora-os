import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  describeGlsSyncState,
  glsGmailCredentials,
  glsSyncIntervalMinutes,
  glsSyncSwitch,
} from "./gls-gmail.config.js";
import { GlsGmailSyncService } from "./gls-gmail-sync.service.js";

const STARTUP_DELAY_MS = 90_000;

/**
 * Runs the GLS Gmail pull on a timer when it is on, and says so in ONE log
 * line at start either way: the Foxpost pull's silence while off is what hid
 * seven weeks of not running.
 */
@Injectable()
export class GlsGmailSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlsGmailSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: GlsGmailSyncService) {}

  onModuleInit(): void {
    const switchState = glsSyncSwitch(process.env.GMAIL_GLS_SYNC_ENABLED);
    const credentials = glsGmailCredentials();
    const intervalMinutes = glsSyncIntervalMinutes();
    this.logger.log(
      describeGlsSyncState(switchState, credentials, intervalMinutes),
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
      await this.sync.sync();
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "GLS_GMAIL_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("GLS Gmail sync skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled GLS Gmail sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "GLS_GMAIL_SYNC_SCHEDULED_FAILED"
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
