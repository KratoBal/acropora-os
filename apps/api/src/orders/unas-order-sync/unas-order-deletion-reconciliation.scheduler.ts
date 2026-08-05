import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import {
  unasOrderDeletionReconciliationConfig,
  UnasOrderDeletionReconciliationService,
  type DeletionReconciliationBatchSummary,
} from "./unas-order-deletion-reconciliation.service.js";

/// Self-rescheduling poller for the UNAS order-deletion reconciliation
/// worker - same setTimeout(...).unref(), schedule-after-previous-finishes
/// pattern as UnasStockSyncOutboxScheduler/UnasOrderSyncScheduler (see
/// UnasStockSyncOutboxScheduler's own doc comment for why not
/// setInterval). Disabled by default - see
/// unasOrderDeletionReconciliationConfig's own doc comment and business
/// rule 6's explicit "alapértelmezetten kikapcsolt feature flag"
/// requirement.
@Injectable()
export class UnasOrderDeletionReconciliationScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    UnasOrderDeletionReconciliationScheduler.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly service: UnasOrderDeletionReconciliationService) {}

  onModuleInit() {
    const config = unasOrderDeletionReconciliationConfig();
    if (!config.enabled) return;
    this.logger.log(
      `UNAS order deletion-reconciliation worker enabled (every ${config.intervalMs / 60_000} min, batch=${config.batchSize})`,
    );
    this.schedule(config.startupDelayMs);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Never throws - both the self-rescheduling loop and the manual "run
  // now" admin endpoint call this directly (mirrors
  // UnasStockSyncOutboxScheduler.runOnce's own doc comment).
  async runOnce(): Promise<
    DeletionReconciliationBatchSummary | "DISABLED" | "FAILED"
  > {
    const config = unasOrderDeletionReconciliationConfig();
    if (!config.enabled) return "DISABLED";
    try {
      const summary = await this.service.processBatch(config);
      if (summary.claimed > 0) {
        this.logger.log(
          `UNAS order deletion-reconciliation batch: claimed=${summary.claimed} stillExists=${summary.stillExists} reconciledDeleted=${summary.reconciledDeleted} alreadyReconciled=${summary.alreadyReconciled} transientFailure=${summary.transientFailure} skippedNoKey=${summary.skippedNoKey}`,
        );
      }
      return summary;
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message.slice(0, 200)
          : "UNAS_ORDER_DELETION_RECONCILIATION_BATCH_FAILED";
      this.logger.error(`UNAS order deletion-reconciliation batch failed: ${code}`);
      return "FAILED";
    }
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        const config = unasOrderDeletionReconciliationConfig();
        if (!this.stopped) this.schedule(config.intervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }
}
