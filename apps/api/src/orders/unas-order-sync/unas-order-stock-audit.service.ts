import { Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  computeCurrentTargetOut,
  computeRiskFlags,
  UnasOrderStockAuditRepository,
} from "./unas-order-stock-audit.repository.js";
import type {
  UnasOrderAuditAnomalies,
  UnasOrderAuditPage,
  UnasOrderAuditRiskFlag,
  UnasOrderAuditRow,
  UnasOrderAuditSummary,
} from "./unas-order-stock-audit.types.js";

const ALL_RISK_FLAGS: readonly UnasOrderAuditRiskFlag[] = [
  "MISSING_EXTERNAL_REFERENCE",
  "DUPLICATE_UNAS_KEY",
  "ACTIVE_ORDER_ZERO_BOOKED",
  "CANCELLED_ORDER_POSITIVE_BOOKED",
  "NEGATIVE_BOOKED_QUANTITY",
];

/// Read-only historical UNAS order audit - the checkpoint-4 production-
/// activation precondition (see docs/INVENTORY-CONSISTENCY.md). Never
/// writes to SalesOrder/SalesOrderLine/StockMovement/ExternalReference;
/// every method here is safe to run against a live production database at
/// any time without side effects.
@Injectable()
export class UnasOrderStockAuditService {
  constructor(private readonly repository: UnasOrderStockAuditRepository) {}

  async auditPage(params: {
    page: number;
    pageSize: number;
  }): Promise<UnasOrderAuditPage> {
    const [
      {
        orders,
        unasKeyByOrderId,
        bookedOutByOrderId,
        targetOutByOrderId,
        totalItems,
      },
      duplicates,
    ] = await Promise.all([
      this.repository.auditPage(params),
      this.repository.findDuplicateUnasKeys(),
    ]);
    const duplicateOrderIds = new Set(
      duplicates.flatMap((entry) => entry.salesOrderIds),
    );

    const items: UnasOrderAuditRow[] = orders.map((order) => {
      const unasKey = unasKeyByOrderId.get(order.id) ?? null;
      const targetOut =
        targetOutByOrderId.get(order.id) ??
        computeCurrentTargetOut(order.lines);
      const bookedOut = bookedOutByOrderId.get(order.id) ?? new Map();
      const riskFlags = computeRiskFlags({
        status: order.status,
        unasKey,
        targetOut,
        bookedOut,
      });
      if (duplicateOrderIds.has(order.id)) riskFlags.push("DUPLICATE_UNAS_KEY");

      const zero = new Prisma.Decimal(0);
      const variantIds = new Set([...targetOut.keys(), ...bookedOut.keys()]);
      const targetOutByVariant: Record<string, string> = {};
      const bookedOutByVariant: Record<string, string> = {};
      const deltaByVariant: Record<string, string> = {};
      for (const variantId of variantIds) {
        const target = targetOut.get(variantId) ?? zero;
        const booked = bookedOut.get(variantId) ?? zero;
        targetOutByVariant[variantId] = target.toString();
        bookedOutByVariant[variantId] = booked.toString();
        deltaByVariant[variantId] = target.minus(booked).toString();
      }

      return {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        unasKey,
        bookedOutByVariant,
        targetOutByVariant,
        deltaByVariant,
        riskFlags,
      } satisfies UnasOrderAuditRow;
    });

    return {
      items,
      page: params.page,
      pageSize: params.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / params.pageSize) || 1,
    };
  }

  async findAnomalies(): Promise<UnasOrderAuditAnomalies> {
    const [duplicateUnasKeys, orphanStockMovementReferenceIds] =
      await Promise.all([
        this.repository.findDuplicateUnasKeys(),
        this.repository.findOrphanStockMovementReferences(),
      ]);
    return {
      checkedAt: new Date().toISOString(),
      duplicateUnasKeys,
      orphanStockMovementReferenceIds,
    };
  }

  /// Walks every UNAS order in bounded batches to produce the go/no-go
  /// summary for checkpoint 4's production activation - see
  /// docs/INVENTORY-CONSISTENCY.md's activation-plan section for exactly
  /// what "safe" means here (in short: no risk flags on any order, and no
  /// global anomaly).
  async summarize(
    params: { batchSize?: number } = {},
  ): Promise<UnasOrderAuditSummary> {
    const pageSize = params.batchSize ?? 200;
    const riskFlagCounts: Record<UnasOrderAuditRiskFlag, number> = {
      MISSING_EXTERNAL_REFERENCE: 0,
      DUPLICATE_UNAS_KEY: 0,
      ACTIVE_ORDER_ZERO_BOOKED: 0,
      CANCELLED_ORDER_POSITIVE_BOOKED: 0,
      NEGATIVE_BOOKED_QUANTITY: 0,
    };
    let ordersChecked = 0;
    let ordersWithRiskFlags = 0;
    let page = 1;
    let totalPages = 1;
    do {
      const result = await this.auditPage({ page, pageSize });
      totalPages = result.totalPages;
      for (const row of result.items) {
        ordersChecked += 1;
        if (row.riskFlags.length > 0) ordersWithRiskFlags += 1;
        for (const flag of row.riskFlags) riskFlagCounts[flag] += 1;
      }
      page += 1;
    } while (page <= totalPages);

    const anomalies = await this.findAnomalies();
    const blockingReasons: string[] = [];
    if (ordersWithRiskFlags > 0) {
      blockingReasons.push(
        `${ordersWithRiskFlags} rendelésen van legalább egy kockázati jelző (részletek: auditPage).`,
      );
    }
    if (anomalies.orphanStockMovementReferenceIds.length > 0) {
      blockingReasons.push(
        `${anomalies.orphanStockMovementReferenceIds.length} árva StockMovement-referencia (nem létező SalesOrder-re mutat).`,
      );
    }
    // duplicateUnasKeys is already folded into riskFlagCounts.DUPLICATE_UNAS_KEY
    // via the per-order rows above, so it isn't double-counted here as its
    // own blocking reason - just kept in the returned summary count for
    // visibility.

    return {
      checkedAt: new Date().toISOString(),
      ordersChecked,
      ordersWithRiskFlags,
      riskFlagCounts,
      duplicateUnasKeyCount: anomalies.duplicateUnasKeys.length,
      orphanStockMovementReferenceCount:
        anomalies.orphanStockMovementReferenceIds.length,
      safeToActivateWithoutBackfill: blockingReasons.length === 0,
      blockingReasons,
    };
  }
}

// Re-exported so ALL_RISK_FLAGS stays a single source of truth if a future
// caller (e.g. a controller listing valid filter values) needs it.
export { ALL_RISK_FLAGS };
