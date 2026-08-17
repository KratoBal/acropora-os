import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { StockReconciliationRepository } from "./stock-reconciliation.repository.js";
import { StockReconciliationRepairRepository } from "./stock-reconciliation-repair.repository.js";
import {
  buildRepairIdempotencyKey,
  evaluateLocalFromProvenLedgerPreconditions,
  evaluateRepublishPreconditions,
} from "./stock-reconciliation-repair.util.js";
import type {
  RepairLocalFromProvenLedgerInput,
  RepublishLocalToUnasInput,
  StockReconciliationRepairOutcome,
  StockReconciliationRepairRecord,
} from "./stock-reconciliation-repair.types.js";

/// Orchestration layer for the checkpoint-6 auditable repair mechanism.
/// Deliberately thin: every actual mutation (lock, fresh re-read,
/// precondition re-check, StockItem/outbox write, audit-row insert) lives
/// in StockReconciliationRepairRepository's transactional methods - this
/// class only:
///  1. resolves the target StockItem's (variantId, warehouseId) via the
///     EXISTING read-only reconciliation repository (never invents its own
///     lookup/status logic - reuses stock-reconciliation.repository.ts's
///     `reconcileByStockItemId`, the same code the diagnostics UI itself
///     calls);
///  2. computes the server-derived idempotency key (see
///     stock-reconciliation-repair.util.ts's own doc comment for the exact
///     format and why it is never client-supplied);
///  3. short-circuits a repeated call for an unchanged idempotency key to
///     the SAME persisted result, without re-running anything;
///  4. for `dryRun`, returns a preview computed from that same read-only
///     lookup and writes NOTHING - not even an audit row (checkpoint's own
///     explicit instruction, since no existing convention in this codebase
///     writes an audit row for a dry-run);
///  5. otherwise, delegates to the repository's transactional apply
///     method, which independently re-verifies everything under the
///     advisory lock rather than trusting this preview.
@Injectable()
export class StockReconciliationRepairService {
  constructor(
    private readonly reconciliation: StockReconciliationRepository,
    private readonly repairs: StockReconciliationRepairRepository,
  ) {}

  async repairLocalFromProvenLedger(
    input: RepairLocalFromProvenLedgerInput,
  ): Promise<StockReconciliationRepairOutcome> {
    if (!input.reason.trim()) {
      throw new BadRequestException("A javítás indoklása (reason) kötelező.");
    }
    const expectedCurrentOnHand = this.parseDecimal(
      input.expectedCurrentOnHand,
    );
    const idempotencyKey = buildRepairIdempotencyKey(
      "LOCAL_FROM_PROVEN_LEDGER",
      input.stockItemId,
      expectedCurrentOnHand.toString(),
    );

    if (!input.dryRun) {
      const existing = await this.repairs.findByIdempotencyKey(idempotencyKey);
      if (existing) return this.toReplayOutcome(existing);
    }

    const preview = await this.reconciliation.reconcileByStockItemId(
      input.stockItemId,
    );
    if (!preview) {
      throw new NotFoundException(
        "Nincs ilyen StockItem (törölve, vagy soha nem is létezett).",
      );
    }
    if (preview.localOnHand === null) {
      // Structurally shouldn't happen: reconcileByStockItemId only ever
      // returns a row for an EXISTING StockItem, and localOnHand is null
      // in StockReconciliationRow only for the complementary "missing
      // StockItem" universe (findVariantsMissingStockItem), which never
      // reaches here. Defensive, not expected.
      throw new BadRequestException(
        "A StockItem aktuális készlete nem olvasható.",
      );
    }

    const rejectionCode = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: preview.ledgerProvable,
      localOnHand: new Prisma.Decimal(preview.localOnHand),
      expectedCurrentOnHand,
    });

    if (input.dryRun) {
      return {
        dryRun: true,
        status: rejectionCode ? "REJECTED" : "APPLIED",
        rejectionCode,
        variantId: preview.variantId,
        warehouseId: preview.warehouseId,
        ledgerExpectedOnHand: preview.ledgerExpectedOnHand,
        beforeOnHand: preview.localOnHand,
        afterOnHand: rejectionCode ? null : preview.ledgerExpectedOnHand,
        outboxId: null,
        repairId: null,
        replayedExisting: false,
      };
    }

    return this.repairs.applyLocalFromProvenLedger({
      variantId: preview.variantId,
      warehouseId: preview.warehouseId,
      expectedCurrentOnHand,
      reason: input.reason,
      actorUserId: input.actorUserId,
      idempotencyKey,
    });
  }

  async republishLocalToUnas(
    input: RepublishLocalToUnasInput,
  ): Promise<StockReconciliationRepairOutcome> {
    if (!input.reason.trim()) {
      throw new BadRequestException("A javítás indoklása (reason) kötelező.");
    }
    const expectedCurrentOnHand = this.parseDecimal(
      input.expectedCurrentOnHand,
    );
    const idempotencyKey = buildRepairIdempotencyKey(
      "REPUBLISH_LOCAL_TO_UNAS",
      input.stockItemId,
      expectedCurrentOnHand.toString(),
    );

    if (!input.dryRun) {
      const existing = await this.repairs.findByIdempotencyKey(idempotencyKey);
      if (existing) return this.toReplayOutcome(existing);
    }

    const preview = await this.reconciliation.reconcileByStockItemId(
      input.stockItemId,
    );
    if (!preview) {
      throw new NotFoundException(
        "Nincs ilyen StockItem (törölve, vagy soha nem is létezett).",
      );
    }
    if (preview.localOnHand === null) {
      throw new BadRequestException(
        "A StockItem aktuális készlete nem olvasható.",
      );
    }

    // Best-effort preview only - see this class's own doc comment above:
    // the authoritative "is anything PENDING/PROCESSING already queued"
    // check happens fresh, under the advisory lock, inside
    // applyRepublishLocalToUnas itself. hasPendingCorrection covers
    // PENDING/unsuperseded-FAILED; latestStatus === "PROCESSING" covers the
    // one open state that flag doesn't (see diagnoseOutbox's
    // SUPERSEDABLE_STATUSES, which deliberately excludes PROCESSING).
    const hasCompetingOpenOutboxRow =
      preview.outbox.hasPendingCorrection ||
      preview.outbox.latestStatus === "PROCESSING";

    const rejectionCode = evaluateRepublishPreconditions({
      hasUnasLink: preview.unasOnHand !== null,
      localOnHand: new Prisma.Decimal(preview.localOnHand),
      expectedCurrentOnHand,
      hasCompetingOpenOutboxRow,
    });

    if (input.dryRun) {
      return {
        dryRun: true,
        status: rejectionCode ? "REJECTED" : "APPLIED",
        rejectionCode,
        variantId: preview.variantId,
        warehouseId: preview.warehouseId,
        ledgerExpectedOnHand: preview.ledgerExpectedOnHand,
        beforeOnHand: preview.localOnHand,
        afterOnHand: rejectionCode ? null : preview.localOnHand,
        outboxId: null,
        repairId: null,
        replayedExisting: false,
      };
    }

    return this.repairs.applyRepublishLocalToUnas({
      variantId: preview.variantId,
      warehouseId: preview.warehouseId,
      hasUnasLink: preview.unasOnHand !== null,
      expectedCurrentOnHand,
      reason: input.reason,
      actorUserId: input.actorUserId,
      idempotencyKey,
    });
  }

  async getRepair(repairId: string): Promise<StockReconciliationRepairRecord> {
    const record = await this.repairs.findById(repairId);
    if (!record) throw new NotFoundException("Nincs ilyen repair-rekord.");
    return record;
  }

  private toReplayOutcome(
    existing: StockReconciliationRepairRecord,
  ): StockReconciliationRepairOutcome {
    return {
      dryRun: false,
      status: existing.status,
      rejectionCode: existing.rejectionCode,
      variantId: existing.variantId,
      warehouseId: existing.warehouseId,
      ledgerExpectedOnHand: existing.ledgerExpectedOnHand,
      beforeOnHand: existing.beforeOnHand,
      afterOnHand: existing.afterOnHand,
      outboxId: existing.outboxId,
      repairId: existing.id,
      replayedExisting: true,
    };
  }

  private parseDecimal(value: string): Prisma.Decimal {
    try {
      return new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(
        "Az expectedCurrentOnHand nem érvényes decimális szám.",
      );
    }
  }
}
