import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { msUntilNextRun } from "../../billing/paid-marks/paid-marks-auto.scheduler.js";
import { EBIZ_ENV, ebizApiKey } from "./ebiz.client.js";
import { EbizSyncService } from "./ebiz-sync.service.js";

/**
 * ONCE A DAY, AT 05:00 SERVER TIME, before the working day and before the
 * 07:00 paid-mark run. The first run loads the whole history; later runs
 * bring the new invoices and the payment / cancellation changes.
 *
 * Without `OTP_EBIZ_API_KEY` it only logs one line and schedules nothing.
 * Same timer pattern as the paid marks: a self-rescheduling, unref'd timeout.
 */
export const EBIZ_SYNC_HOUR = 5;

@Injectable()
export class EbizSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("EbizSync");
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly sync: EbizSyncService,
    @Optional()
    @Inject(EBIZ_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  onModuleInit(): void {
    if (!ebizApiKey(this.env)) {
      this.logger.log("OTP eBIZ szinkron: nincs beállítva (OTP_EBIZ_API_KEY).");
      return;
    }
    this.logger.log(
      `OTP eBIZ szinkron: naponta ${EBIZ_SYNC_HOUR}:00-kor, csak olvasás.`,
    );
    this.schedule();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => void this.tick(),
      msUntilNextRun(new Date(), EBIZ_SYNC_HOUR),
    );
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.sync.run("SCHEDULED");
      if (result.state === "APPLIED")
        this.logger.log(
          `OTP eBIZ: ${result.fetchedCount} számla, ${result.createdCount} új, ${result.updatedCount} változott, ${result.pdfStoredCount} PDF, ${result.failedCount} hiba.`,
        );
    } catch (error) {
      this.logger.error(
        `OTP eBIZ szinkron hiba: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.schedule();
    }
  }
}
