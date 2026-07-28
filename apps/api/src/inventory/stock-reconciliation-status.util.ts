import type { Prisma } from "@acropora/database";

import type {
  OutboxDiagnosis,
  ReconciliationStatus,
} from "./stock-reconciliation.types.js";

/// Pure decision function - the entire "conceptual model" the checkpoint
/// asked for, expressed as one deterministic status pick given already-known
/// facts about a single (variantId, warehouseId) pair. Kept in its own,
/// dependency-free module (no NestJS, no repository import) so
/// stock-reconciliation.repository.ts (which builds these facts from the DB)
/// and stock-reconciliation.service.ts (the DI-facing orchestration layer,
/// which depends on the repository) can BOTH import it without creating a
/// repository<->service circular import - and so it's directly
/// unit-testable with hand-built inputs, no FakeDb/Prisma mock required.
///
/// Decision order matters and is deliberate:
///  1. no StockItem row at all is checked first - every other question is
///     moot without one;
///  2. zero ledger movements at all means the current onHand can't be
///     explained by the ledger AT ALL (not even provably wrong) - this is
///     HISTORICAL_BASELINE_UNKNOWN, distinct from a movement existing but
///     being sign-ambiguous (INVALID_LEDGER_DATA, checked next) or provably
///     mismatched (LOCAL_LEDGER_MISMATCH, checked after that);
///  3. a local/ledger mismatch is a purely local-data-integrity concern and
///     is surfaced before anything UNAS-related, since a wrong local number
///     makes any UNAS comparison meaningless anyway;
///  4. outbox-side terminal/stuck states (DEAD_LETTER, an expired
///     PROCESSING lease) are surfaced next, ahead of a plain UNAS mismatch,
///     because they explain WHY a mismatch (if any) isn't self-healing;
///  5. missing UNAS link and a genuine UNAS/local mismatch are checked last,
///     the latter split into "already queued" vs "nothing queued" by
///     whether a pending correction exists.
export function computeReconciliationStatus(params: {
  hasStockItem: boolean;
  ledgerProvable: boolean;
  hasAnyMovement: boolean;
  localVsLedgerDelta: Prisma.Decimal | null;
  hasUnasLink: boolean;
  unasVsLocalDelta: Prisma.Decimal | null;
  outbox: OutboxDiagnosis;
}): ReconciliationStatus {
  if (!params.hasStockItem) return "MISSING_STOCK_ITEM";
  if (!params.hasAnyMovement) return "HISTORICAL_BASELINE_UNKNOWN";
  if (!params.ledgerProvable) return "INVALID_LEDGER_DATA";
  if (params.localVsLedgerDelta && !params.localVsLedgerDelta.isZero()) {
    return "LOCAL_LEDGER_MISMATCH";
  }
  if (params.outbox.latestStatus === "DEAD_LETTER") return "SYNC_FAILED";
  if (
    params.outbox.latestStatus === "PROCESSING" &&
    params.outbox.processingLeaseExpired
  ) {
    return "PROCESSING_LEASE_EXPIRED";
  }
  if (!params.hasUnasLink) return "MISSING_UNAS_LINK";
  if (params.unasVsLocalDelta && !params.unasVsLocalDelta.isZero()) {
    return params.outbox.hasPendingCorrection
      ? "UNAS_BEHIND_PENDING_SYNC"
      : "UNAS_MISMATCH_NO_PENDING_SYNC";
  }
  return "CONSISTENT";
}
