import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  describeInvoiceCollectionState,
  invoiceCollectionIntervalMinutes,
  invoiceCollectionSources,
  invoiceCollectionSwitch,
} from "./invoice-collection.config.js";
import { InvoiceCollectionService } from "./invoice-collection.service.js";

const STARTUP_DELAY_MS = 180_000;

/**
 * A SZÁMLA-BEGYŰJTÉS IDŐZÍTŐJE, KIKAPCSOLVA, AMÍG NEM KAPCSOLJÁK BE
 * (INVOICE_COLLECTION_ENABLED=true). Ugyanaz a minta, mint a többi behúzásé
 * (`expected-arrival.scheduler.ts`): induláskor egy sor arról, fut-e és miért,
 * utána egy időzítő, ami minden futás után újraütemezi magát.
 */
@Injectable()
export class InvoiceCollectionScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InvoiceCollectionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly collection: InvoiceCollectionService) {}

  onModuleInit(): void {
    const switchState = invoiceCollectionSwitch();
    const sources = invoiceCollectionSources();
    this.logger.log(describeInvoiceCollectionState(switchState, sources));
    if (!switchState.on || !sources.length) return;
    const interval = invoiceCollectionIntervalMinutes() * 60_000;
    this.schedule(STARTUP_DELAY_MS, interval);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      await this.collection.run("SCHEDULED");
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "INVOICE_COLLECTION_ALREADY_RUNNING"
      ) {
        this.logger.log("Invoice collection skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled invoice collection failed: ${
          error instanceof Error && /^[A-Z0-9_:.,-]+$/.test(error.message)
            ? error.message
            : "INVOICE_COLLECTION_SCHEDULED_FAILED"
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
