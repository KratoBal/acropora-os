import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  unasStockSyncWorkerConfig,
  UnasStockSyncOutboxService,
  type ProcessBatchSummary,
} from "./unas-stock-sync-outbox.service.js";

/// Self-rescheduling poller for the UNAS stock-sync outbox worker - same
/// setTimeout(...).unref() pattern as UnasOrderSyncScheduler, deliberately
/// not setInterval: a setInterval tick would fire again mid-batch if a
/// batch ever runs longer than the configured interval, causing two
/// concurrent processBatch() calls from the SAME process. The claim SQL
/// (FOR UPDATE SKIP LOCKED) makes that safe even so, but scheduling the
/// next tick only after the current one finishes keeps steady-state
/// behavior easier to reason about and avoids unbounded backlog if UNAS is
/// slow to respond.
@Injectable()
export class UnasStockSyncOutboxScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UnasStockSyncOutboxScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly service: UnasStockSyncOutboxService) {}

  onModuleInit() {
    const config = unasStockSyncWorkerConfig();
    if (!config.enabled) return;
    this.logger.log(
      `UNAS stock sync outbox worker enabled (every ${config.intervalMs / 1000}s, batch=${config.batchSize})`,
    );
    this.schedule(config.startupDelayMs);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Never throws - both the self-rescheduling loop and the manual "run
  // now" admin endpoint call this directly, and neither should crash (or,
  // for the endpoint, return a raw stack trace) if a batch fails
  // unexpectedly. A batch-level failure here means something outside the
  // per-row error handling in UnasStockSyncOutboxService went wrong (e.g.
  // getToken() itself failing); individual row outcomes are always
  // reported via ProcessBatchSummary regardless.
  async runOnce(): Promise<ProcessBatchSummary | "DISABLED" | "FAILED"> {
    const config = unasStockSyncWorkerConfig();
    if (!config.enabled) return "DISABLED";
    try {
      const summary = await this.service.processBatch(config);
      if (summary.claimed > 0) {
        this.logger.log(
          `UNAS stock sync outbox batch: claimed=${summary.claimed} succeeded=${summary.succeeded} superseded=${summary.superseded} retried=${summary.retried} deadLettered=${summary.deadLettered}`,
        );
      }
      return summary;
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message.slice(0, 200)
          : "UNAS_STOCK_SYNC_OUTBOX_BATCH_FAILED";
      this.logger.error(`UNAS stock sync outbox batch failed: ${code}`);
      return "FAILED";
    }
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        const config = unasStockSyncWorkerConfig();
        if (!this.stopped) this.schedule(config.intervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }
}
