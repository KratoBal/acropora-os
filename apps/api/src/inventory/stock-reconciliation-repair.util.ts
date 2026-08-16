import type { Prisma } from "@acropora/database";

import type {
  RepairRejectionCode,
  StockReconciliationRepairType,
} from "./stock-reconciliation-repair.types.js";

/// `RECONCILIATION_REPAIR:<repairType>:<stockItemId>:<expectedCurrentOnHand>`.
///
/// Why this shape:
///  - no sensitive data (stockItemId is an internal cuid, not a customer/
///    order identifier; expectedCurrentOnHand is a plain quantity);
///  - fits comfortably in a TEXT column (Decimal.toString() is short and
///    bounded);
///  - a repeated call for the SAME stockItemId asserting the SAME
///    expectedCurrentOnHand is, by definition, the SAME logical repair
///    attempt - retrying it is naturally deduped by the unique constraint,
///    matching every other idempotency key in this codebase
///    (postInventoryMovement, the UNAS order delta engine);
///  - a LATER, legitimate repair against a DIFFERENT before-state (the
///    stock moved again since the last repair, so expectedCurrentOnHand is
///    now a different number) gets a different key automatically - no A->
///    B->A collision analysis is needed here the way it was for the UNAS
///    order engine's generation counter, because expectedCurrentOnHand
///    already IS the state fingerprint for a point-in-time correction:
///    there is no multi-step business object whose identical state could
///    legitimately recur and need a *distinct* event marker the way an
///    order's A->B->A transition does.
export function buildRepairIdempotencyKey(
  repairType: StockReconciliationRepairType,
  stockItemId: string,
  expectedCurrentOnHand: string,
): string {
  return `RECONCILIATION_REPAIR:${repairType}:${stockItemId}:${expectedCurrentOnHand}`;
}

/// Preconditions shared by LOCAL_FROM_PROVEN_LEDGER: rejects unless the
/// ledger is genuinely provable and the caller's asserted current value
/// still matches reality. Deliberately pure (no DB access) so it's
/// unit-testable without a FakeDb, and so the service can call it BOTH
/// for the pre-lock preview (dry-run's answer, and an early exit for the
/// real path) and again, unchanged, for the authoritative post-lock check
/// - the exact same function, not two hand-synced copies of the same
/// rule.
export function evaluateLocalFromProvenLedgerPreconditions(params: {
  ledgerProvable: boolean;
  localOnHand: Prisma.Decimal | null;
  expectedCurrentOnHand: Prisma.Decimal;
}): RepairRejectionCode | null {
  if (!params.ledgerProvable) return "LEDGER_NOT_PROVABLE";
  // Numeric comparison, not string comparison: "5", "5.0" and "5.000000"
  // must all be treated as the same value - Decimal.equals handles this
  // correctly, a raw string compare would not.
  if (
    !params.localOnHand ||
    !params.localOnHand.equals(params.expectedCurrentOnHand)
  ) {
    return "STALE_EXPECTED_CURRENT_VALUE";
  }
  return null;
}

/// Preconditions shared by REPUBLISH_LOCAL_TO_UNAS: rejects unless the
/// variant is UNAS-linked, the caller's asserted current value still
/// matches, and no PENDING/PROCESSING outbox row already covers this pair.
export function evaluateRepublishPreconditions(params: {
  hasUnasLink: boolean;
  localOnHand: Prisma.Decimal | null;
  expectedCurrentOnHand: Prisma.Decimal;
  hasCompetingOpenOutboxRow: boolean;
}): RepairRejectionCode | null {
  if (!params.hasUnasLink) return "MISSING_UNAS_LINK";
  if (
    !params.localOnHand ||
    !params.localOnHand.equals(params.expectedCurrentOnHand)
  ) {
    return "STALE_EXPECTED_CURRENT_VALUE";
  }
  if (params.hasCompetingOpenOutboxRow) return "ALREADY_QUEUED";
  return null;
}
