import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  UnasApiClient,
  UnasApiError,
} from "../imports/unas/unas-api.client.js";
import type { UnasApiErrorCode } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import {
  UnasStockSyncOutboxRepository,
  type ClaimedUnasStockSyncOutboxRow,
} from "./unas-stock-sync-outbox.repository.js";

export interface UnasStockSyncWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
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

/// See docs/INVENTORY-CONSISTENCY.md "UNAS stock sync outbox
/// worker" for the full rationale behind each default. Kept in one place
/// (mirrors unasOrderSyncScheduleConfig's style) so `.env.example` and this
/// function can never silently drift apart.
export function unasStockSyncWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UnasStockSyncWorkerConfig {
  const enabled = environment.UNAS_STOCK_SYNC_WORKER_ENABLED === "true";
  if (!enabled) {
    return {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
      batchSize: 0,
      leaseSeconds: 0,
      maxAttempts: 0,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
    };
  }
  const intervalSeconds = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_INTERVAL_SECONDS,
    15,
    1,
    3600,
    "INVALID_UNAS_STOCK_SYNC_WORKER_INTERVAL_SECONDS",
  );
  const startupDelaySeconds = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_STARTUP_DELAY_SECONDS,
    30,
    0,
    3600,
    "INVALID_UNAS_STOCK_SYNC_WORKER_STARTUP_DELAY_SECONDS",
  );
  const batchSize = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_BATCH_SIZE,
    20,
    1,
    200,
    "INVALID_UNAS_STOCK_SYNC_WORKER_BATCH_SIZE",
  );
  // Comfortably longer than setStock's own worst case (its internal
  // MAX_HTTP_ATTEMPTS=3 retries, each up to ~5s backoff plus request time)
  // so a merely-slow-but-alive worker is never mistaken for a crashed one.
  const leaseSeconds = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_LEASE_SECONDS,
    120,
    10,
    3600,
    "INVALID_UNAS_STOCK_SYNC_WORKER_LEASE_SECONDS",
  );
  const maxAttempts = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_MAX_ATTEMPTS,
    8,
    1,
    50,
    "INVALID_UNAS_STOCK_SYNC_WORKER_MAX_ATTEMPTS",
  );
  const baseBackoffSeconds = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS,
    30,
    1,
    3600,
    "INVALID_UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS",
  );
  const maxBackoffSeconds = boundedInteger(
    environment.UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS,
    1800,
    baseBackoffSeconds,
    86_400,
    "INVALID_UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS",
  );
  return {
    enabled,
    intervalMs: intervalSeconds * 1000,
    startupDelayMs: startupDelaySeconds * 1000,
    batchSize,
    leaseSeconds,
    maxAttempts,
    baseBackoffMs: baseBackoffSeconds * 1000,
    maxBackoffMs: maxBackoffSeconds * 1000,
  };
}

/// Codes for which retrying the *identical* request will never succeed on
/// its own (malformed payload, response shape UNAS will always reject the
/// same way, forbidden/oversized content) - these go straight to
/// DEAD_LETTER without burning the retry budget. Everything else
/// (network/timeout/rate-limit/5xx/auth/ambiguous 4xx/business rejection)
/// is treated as transient and retried with backoff, since it may well
/// resolve on its own (UNAS-side hiccup, token refresh, temporary product
/// state) - see docs/INVENTORY-CONSISTENCY.md for the full
/// list and reasoning.
const PERMANENT_UNAS_ERROR_CODES = new Set<UnasApiErrorCode>([
  "REQUEST_INVALID",
  "FIELD_FORMAT_INVALID",
  "XML_FORBIDDEN",
  "XML_TOO_LARGE",
  "XML_INVALID",
  "RESPONSE_SHAPE_INVALID",
]);

/// Reduces an arbitrary caught error to a safe-to-persist string. Never
/// stores raw error messages/stacks, which could contain request payloads,
/// tokens, or other sensitive detail baked in by a lower layer - only a
/// UnasApiError's closed-enum `code`, or an already-code-shaped Error
/// message (same convention as unas-order-sync.scheduler.ts), or a fixed
/// fallback otherwise.
function classifyError(error: unknown): { code: string; permanent: boolean } {
  if (error instanceof UnasApiError) {
    return {
      code: error.code,
      permanent: PERMANENT_UNAS_ERROR_CODES.has(error.code),
    };
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)) {
    return { code: error.message.slice(0, 200), permanent: false };
  }
  return { code: "UNAS_STOCK_SYNC_UNEXPECTED_ERROR", permanent: false };
}

/// attempts is the count *after* this attempt (claimBatch increments it
/// atomically as part of the claim) - so attempts=1 means "this was the
/// first try and it just failed".
export function computeNextAttemptDelayMs(
  attempts: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export interface StockLookupDatabase {
  stockItem: {
    findFirst(args: unknown): Promise<{
      onHand: Prisma.Decimal;
      reserved: Prisma.Decimal;
    } | null>;
  };
}

export const STOCK_LOOKUP_DATABASE = Symbol("STOCK_LOOKUP_DATABASE");

export interface ProcessBatchSummary {
  claimed: number;
  succeeded: number;
  superseded: number;
  retried: number;
  deadLettered: number;
}

@Injectable()
export class UnasStockSyncOutboxService {
  private readonly logger = new Logger(UnasStockSyncOutboxService.name);
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly stockLookup: StockLookupDatabase;

  constructor(
    private readonly outbox: UnasStockSyncOutboxRepository,
    private readonly unasApi: UnasApiClient,
    private readonly unasAuth: UnasAuthService,
    @Optional()
    @Inject(STOCK_LOOKUP_DATABASE)
    stockLookup?: StockLookupDatabase,
  ) {
    this.stockLookup =
      stockLookup ?? (prisma as unknown as StockLookupDatabase);
  }

  /// Claims and processes one batch. Called by the scheduler on its own
  /// timer, and by the manual "run now" admin endpoint - both go through
  /// this exact same path, so there is no separate, less-tested code
  /// route for the manual trigger.
  async processBatch(
    config: UnasStockSyncWorkerConfig,
  ): Promise<ProcessBatchSummary> {
    const summary: ProcessBatchSummary = {
      claimed: 0,
      succeeded: 0,
      superseded: 0,
      retried: 0,
      deadLettered: 0,
    };
    const claimed = await this.outbox.claimBatch({
      batchSize: config.batchSize,
      leaseSeconds: config.leaseSeconds,
      workerId: this.workerId,
    });
    summary.claimed = claimed.length;
    if (claimed.length === 0) return summary;

    // Fetch the token once per batch, not once per row - setStock still
    // handles a mid-batch expiry itself via its own retry loop, this just
    // avoids N redundant getToken() calls for the common case.
    const token = await this.unasAuth.getToken();

    for (const row of claimed) {
      const outcome = await this.processOne(row, token, config);
      summary[outcome] += 1;
    }
    return summary;
  }

  private async processOne(
    row: ClaimedUnasStockSyncOutboxRow,
    token: string,
    config: UnasStockSyncWorkerConfig,
  ): Promise<"succeeded" | "superseded" | "retried" | "deadLettered"> {
    // Requirement: never let an older event overwrite a newer one, even if
    // the newer one arrived while this row was already PROCESSING (so it
    // wasn't eligible for the writer's supersede-on-create step). This is
    // the second line of defense promised in inventory-movement-writer.ts.
    const superseded = await this.outbox.isSuperseded({
      id: row.id,
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      sequence: row.sequence,
    });
    if (superseded) {
      await this.outbox.markSupersededSuccess(
        row.id,
        superseded.supersededByOutboxId,
      );
      return "superseded";
    }

    // Re-read the current local on-hand rather than trusting the value
    // captured when this row was written (see docs/architecture/
    // inventory-consistency.md, "Mit publikálunk ténylegesen"). Given the
    // architectural invariant that StockItem only ever changes through
    // postInventoryMovement (which always pairs a movement with an outbox
    // row), this is provably equal to targetOnHand whenever no newer row
    // exists for the key - the isSuperseded check above already ruled that
    // out. Re-reading is deliberately kept anyway as defense in depth: if
    // that invariant is ever violated by future code, UNAS still ends up
    // with the true current stock, not a stale snapshot.
    const currentStock = await this.stockLookup.stockItem.findFirst({
      where: {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        locationId: null,
        lotId: null,
      },
      select: { onHand: true, reserved: true },
    });
    const quantityToPublish = currentStock
      ? currentStock.onHand.minus(currentStock.reserved)
      : row.targetOnHand;

    try {
      await this.unasApi.setStock(token, {
        sku: row.sku,
        qty: quantityToPublish.toString(),
        comment: `${row.sourceProcess}:${row.sourceRecordId}`,
      });
      await this.outbox.markSucceeded(row.id);
      return "succeeded";
    } catch (error) {
      const { code, permanent } = classifyError(error);
      if (permanent || row.attempts >= config.maxAttempts) {
        this.logger.warn(
          `UNAS stock sync outbox ${row.id} (sku=${row.sku}) moved to DEAD_LETTER after ${row.attempts} attempt(s): ${code}`,
        );
        await this.outbox.markDeadLetter({ id: row.id, lastError: code });
        return "deadLettered";
      }
      const delayMs = computeNextAttemptDelayMs(
        row.attempts,
        config.baseBackoffMs,
        config.maxBackoffMs,
      );
      await this.outbox.markFailedForRetry({
        id: row.id,
        lastError: code,
        nextAttemptAt: new Date(Date.now() + delayMs),
      });
      return "retried";
    }
  }
}
