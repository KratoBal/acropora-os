import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import {
  UnasApiClient,
  UnasApiError,
} from "../../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import {
  UnasOrderDeletionReconciliationRepository,
  type ClaimedDeletionCandidate,
} from "./unas-order-deletion-reconciliation.repository.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";

export interface UnasOrderDeletionReconciliationConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
  batchSize: number;
  leaseSeconds: number;
  /// How long a confirmed-still-existing order waits before its NEXT
  /// existence check - deliberately long (default 24h): this is a rare-
  /// event safety net for the one gap the incremental sync/manual refresh
  /// can't close (a physical deletion of an order that never gets manually
  /// refreshed and never resurfaces in an incremental window because
  /// nothing about it changes again), not a replacement for either.
  recheckIntervalMs: number;
  /// Backoff after a TRANSIENT check failure (network/timeout/auth/rate-
  /// limit/5xx/malformed response) - short relative to recheckIntervalMs,
  /// so a temporary UNAS outage doesn't silently defer a real order for a
  /// full day.
  baseBackoffMs: number;
  maxBackoffMs: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  errorCode: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(errorCode);
  return parsed;
}

/// See docs/INVENTORY-CONSISTENCY.md "UNAS-ból fizikailag törölt
/// rendelések" for the full rationale behind each default, and business
/// rule 6's explicit requirement that any rollout be "kapcsolható...
/// alapértelmezetten kikapcsolt feature flaggel" - UNAS_ORDER_DELETION_
/// RECONCILIATION_ENABLED defaults to disabled (false) unless explicitly
/// set to "true", mirroring unasStockSyncWorkerConfig's own convention.
export function unasOrderDeletionReconciliationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UnasOrderDeletionReconciliationConfig {
  const enabled =
    environment.UNAS_ORDER_DELETION_RECONCILIATION_ENABLED === "true";
  if (!enabled) {
    return {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
      batchSize: 0,
      leaseSeconds: 0,
      recheckIntervalMs: 0,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
    };
  }
  const intervalMinutes = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_INTERVAL_MINUTES,
    30,
    1,
    1440,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_INTERVAL_MINUTES",
  );
  const startupDelaySeconds = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_STARTUP_DELAY_SECONDS,
    60,
    0,
    3600,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_STARTUP_DELAY_SECONDS",
  );
  // Small, conservative default batch: this worker shares the SAME hourly
  // UNAS call budget (see unas.hu/tudastar/api/limitaciok - PREMIUM
  // 2000/óra, VIP 6000/óra) as the incremental order/product/stock syncs -
  // a getOrderByKey call here is no different from any other UNAS call for
  // rate-limiting purposes.
  const batchSize = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE,
    10,
    1,
    100,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE",
  );
  const leaseSeconds = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_LEASE_SECONDS,
    120,
    10,
    3600,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_LEASE_SECONDS",
  );
  const recheckIntervalHours = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_RECHECK_HOURS,
    24,
    1,
    24 * 30,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_RECHECK_HOURS",
  );
  const baseBackoffSeconds = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_BASE_BACKOFF_SECONDS,
    60,
    1,
    3600,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_BASE_BACKOFF_SECONDS",
  );
  const maxBackoffMinutes = boundedInteger(
    environment.UNAS_ORDER_DELETION_RECONCILIATION_MAX_BACKOFF_MINUTES,
    60,
    1,
    1440,
    "INVALID_UNAS_ORDER_DELETION_RECONCILIATION_MAX_BACKOFF_MINUTES",
  );
  return {
    enabled,
    intervalMs: intervalMinutes * 60_000,
    startupDelayMs: startupDelaySeconds * 1000,
    batchSize,
    leaseSeconds,
    recheckIntervalMs: recheckIntervalHours * 3_600_000,
    baseBackoffMs: baseBackoffSeconds * 1000,
    maxBackoffMs: maxBackoffMinutes * 60_000,
  };
}

export function computeReconciliationBackoffMs(
  attempts: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export interface DeletionReconciliationBatchSummary {
  claimed: number;
  /// Confirmed to still exist in UNAS - due-at simply pushed out.
  stillExists: number;
  /// Confirmed NOT_FOUND via getOrderByKey - reconcileDeletedOrder ran.
  reconciledDeleted: number;
  /// Already unasDeletedAt by a concurrent caller (manual refresh, or
  /// another worker tick) by the time this row's check completed -
  /// reconcileDeletedOrder's own idempotency, surfaced here for
  /// visibility.
  alreadyReconciled: number;
  /// Transient failure (network/timeout/auth/rate-limit/5xx/malformed
  /// response) - NEVER treated as a deletion, per business rule 4.
  /// Rescheduled with backoff.
  transientFailure: number;
  /// No resolvable UNAS Key at all (defensive-only) - skipped without a
  /// UNAS call.
  skippedNoKey: number;
}

@Injectable()
export class UnasOrderDeletionReconciliationService {
  private readonly logger = new Logger(
    UnasOrderDeletionReconciliationService.name,
  );
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly candidates: UnasOrderDeletionReconciliationRepository,
    private readonly orderSync: UnasOrderSyncRepository,
    private readonly api: UnasApiClient,
    private readonly auth: UnasAuthService,
  ) {}

  /// Claims and processes one batch. Called by the scheduler on its own
  /// timer, and by the manual "run now" admin endpoint - both go through
  /// this exact same path (mirrors UnasStockSyncOutboxService.processBatch's
  /// own doc comment), so there is no separate, less-tested manual-trigger
  /// route.
  async processBatch(
    config: UnasOrderDeletionReconciliationConfig,
  ): Promise<DeletionReconciliationBatchSummary> {
    const summary: DeletionReconciliationBatchSummary = {
      claimed: 0,
      stillExists: 0,
      reconciledDeleted: 0,
      alreadyReconciled: 0,
      transientFailure: 0,
      skippedNoKey: 0,
    };
    const claimed = await this.candidates.claimBatch({
      batchSize: config.batchSize,
      leaseSeconds: config.leaseSeconds,
      workerId: this.workerId,
    });
    summary.claimed = claimed.length;
    if (claimed.length === 0) return summary;

    const token = { value: null as string | null };
    for (const row of claimed) {
      const outcome = await this.processOne(row, token, config);
      summary[outcome] += 1;
    }
    return summary;
  }

  private async processOne(
    row: ClaimedDeletionCandidate,
    token: { value: string | null },
    config: UnasOrderDeletionReconciliationConfig,
  ): Promise<keyof DeletionReconciliationBatchSummary> {
    if (!row.unasKey) {
      await this.candidates.skipUnresolvable({
        orderId: row.id,
        nextCheckDelayMs: config.recheckIntervalMs,
      });
      return "skippedNoKey";
    }

    try {
      token.value ??= await this.auth.getToken();
      const order = await this.api.getOrderByKey(token.value, row.unasKey);
      if (order) {
        // Confirmed to still exist - the one non-error outcome. Never
        // touches status/lines/stock here: a full resync of a still-live
        // order is exactly what the incremental sync/manual refresh
        // already do; this worker's job is ONLY existence, not content.
        await this.candidates.releaseAfterCheck({
          orderId: row.id,
          nextCheckDelayMs: config.recheckIntervalMs,
        });
        return "stillExists";
      }

      // Confirmed NOT_FOUND via this exact targeted, single-order lookup -
      // the same proof unas-order-sync.service.ts's refreshOrder() NOT_FOUND
      // branch requires, and the same shared reconciliation core.
      const result = await this.orderSync.reconcileDeletedOrder(
        row.id,
        row.unasKey,
      );
      await this.candidates.clearAfterDeletion(row.id);
      return result.alreadyReconciled
        ? "alreadyReconciled"
        : "reconciledDeleted";
    } catch (error) {
      // Every other outcome (network/timeout/auth/rate-limit/5xx/malformed
      // response - UnasApiError, or anything else thrown by getToken())
      // is, per business rule 4, NEVER treated as a deletion. The order
      // and its stock stay completely untouched; only the check itself is
      // rescheduled with backoff.
      const code =
        error instanceof UnasApiError
          ? error.code
          : "UNAS_ORDER_DELETION_CHECK_UNEXPECTED_ERROR";
      this.logger.warn(
        `UNAS deletion-reconciliation check for order ${row.id} failed transiently (${code}) - rescheduled, no state changed`,
      );
      await this.candidates.releaseAfterCheck({
        orderId: row.id,
        nextCheckDelayMs: computeReconciliationBackoffMs(
          row.attempts,
          config.baseBackoffMs,
          config.maxBackoffMs,
        ),
      });
      return "transientFailure";
    }
  }
}
