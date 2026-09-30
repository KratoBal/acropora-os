import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";
import {
  describeSupplierInvoiceMailState,
  supplierInvoiceMailCredentials,
  supplierInvoiceMailIntervalMinutes,
  supplierInvoiceMailSwitch,
} from "./supplier-invoice-mail.config.js";

const STARTUP_DELAY_MS = 120_000;

/**
 * THE SUPPLIER INVOICE MAIL PULL, ON A TIMER, OFF UNLESS SWITCHED ON
 * (SUPPLIER_INVOICE_MAIL_SYNC_ENABLED=true). The same pattern as every other
 * job here (gls-gmail-sync.scheduler.ts): one line at start-up saying why it
 * runs or not, then a timeout that reschedules itself after each run.
 */
@Injectable()
export class ExpectedArrivalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpectedArrivalScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly intake: ExpectedArrivalIntakeService) {}

  onModuleInit(): void {
    const switchState = supplierInvoiceMailSwitch(
      process.env.SUPPLIER_INVOICE_MAIL_SYNC_ENABLED,
    );
    const credentials = supplierInvoiceMailCredentials();
    const senders = this.intake.senders();
    const intervalMinutes = supplierInvoiceMailIntervalMinutes();
    this.logger.log(
      describeSupplierInvoiceMailState(
        switchState,
        credentials,
        senders,
        intervalMinutes,
      ),
    );
    if (!switchState.on || !credentials || !senders.length) return;
    this.schedule(STARTUP_DELAY_MS, intervalMinutes * 60_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      await this.intake.sync("SCHEDULED");
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "SUPPLIER_INVOICE_MAIL_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log(
          "Supplier invoice mail sync skipped: another run is active",
        );
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled supplier invoice mail sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "SUPPLIER_INVOICE_MAIL_SYNC_SCHEDULED_FAILED"
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
