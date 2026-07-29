import { isPrismaErrorCode } from "./prisma-error.util.js";

/// Prisma's own code for "Transaction failed due to a write conflict or a
/// deadlock. Please retry your transaction" - the exact message this
/// project's Serializable-isolation order-sync transactions (apply(),
/// refreshOrder() in unas-order-sync.repository.ts) can raise under real
/// concurrent load, surfaced by PostgreSQL's serializable-snapshot
/// isolation (SSI) as a `could not serialize access due to concurrent
/// update` / `...due to read/write dependencies among transactions` abort
/// (SQLSTATE 40001). This is NOT evidence of a bug in the order-level
/// advisory lock or the ledger-based idempotency check below it - it is
/// PostgreSQL's own, expected, documented behavior for SERIALIZABLE
/// isolation: the lock correctly prevents two concurrent sightings of the
/// SAME order from double-computing/double-posting a stock delta, but SSI
/// can still abort one of two genuinely concurrent Serializable
/// transactions over dependencies that exist OUTSIDE that locked section
/// (e.g. two concurrent writes to the same SalesOrderLine row before either
/// reaches the lock). PostgreSQL's own documentation is explicit that any
/// application using SERIALIZABLE isolation must be prepared to retry a
/// transaction that fails with a serialization_failure - this helper is
/// that retry, applied to the WHOLE transaction (never a single statement
/// inside it), so every retried attempt is a fresh transaction that
/// re-reads current state from scratch.
const SERIALIZATION_CONFLICT_ERROR_CODE = "P2034";

function jitteredBackoffMs(attempt: number): number {
  // Small, capped, linearly-increasing base (50ms/100ms/150ms/...) plus up
  // to 50ms of jitter - enough to de-correlate two competing retries
  // without meaningfully slowing down the common (no-conflict) case, and
  // deliberately far below any caller-visible timeout.
  const base = 50 * attempt;
  const jitter = Math.floor(Math.random() * 50);
  return base + jitter;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Retries `operation` up to `maxAttempts` times, but ONLY when it rejects
/// with Prisma's P2034 (Postgres serialization-conflict) error code - every
/// other error (a real business error, a different Prisma error code, a
/// non-Prisma exception) is rethrown immediately on the very first
/// attempt, never retried. `operation` is expected to run one complete,
/// self-contained Prisma `$transaction` call per invocation (never a
/// single statement) - since a failed Serializable transaction is rolled
/// back by Postgres in its entirety before this ever sees the rejection,
/// each retry starts a genuinely new transaction against current
/// (post-rollback) state, never a continuation of the failed one. Any
/// transaction-scoped advisory lock (e.g. lockUnasOrder/
/// lockVariantWarehouse) and any idempotency key (e.g. StockMovement's
/// unique idempotencyKey) a retried `operation` acquires/checks internally
/// are therefore unaffected by this wrapper: a failed attempt never
/// commits anything, so a following successful attempt is the only one
/// that ever writes - never a double StockMovement, never a double outbox
/// row, and the caller-supplied idempotencyKey is identical across every
/// attempt (it is computed inside `operation`, not by this helper).
export async function retryOnSerializationConflict<T>(
  operation: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const isRetryable = isPrismaErrorCode(
        error,
        SERIALIZATION_CONFLICT_ERROR_CODE,
      );
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      await delay(jitteredBackoffMs(attempt));
    }
  }
}
