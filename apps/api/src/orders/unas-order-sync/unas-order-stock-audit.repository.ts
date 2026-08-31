import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import { isUnasMasteredVariant } from "../../products/catalog-authority.js";
import { sumOrderBookedOut } from "../../common/stock-ledger.util.js";
import { parseUnasPackageComponents } from "../../common/unas-package-product.util.js";
import type { UnasOrderAuditRiskFlag } from "./unas-order-stock-audit.types.js";

interface AuditOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  lines: Array<{ variantId: string | null; quantity: Prisma.Decimal }>;
}

interface AuditMovementRow {
  referenceId: string | null;
  type: string;
  lines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
}

interface AuditVariantRow {
  id: string;
  sku: string;
  product: {
    catalogAuthority: "UNAS" | "ACROPORA" | null;
    unasSnapshot: {
      isPackageProduct: boolean;
      packageComponents: Prisma.JsonValue;
    } | null;
  };
}

// Every method below maps 1:1 onto a real Prisma client method (findMany /
// count / groupBy) - the constructor falls back to the REAL `prisma` client
// cast to this interface when no test double is injected, so a method name
// that doesn't exist on the actual generated client would throw at runtime.
// Where a call site only needs a narrower field set than the interface's
// declared return shape (e.g. an existence check that only reads `.id`),
// the same `findMany` is reused with a smaller `select` and the call site
// simply doesn't read the other declared fields - the same convention
// unas-order-sync.repository.ts's own hand-written row interfaces already
// follow throughout this codebase, rather than inventing fictional
// per-shape method names.
export interface UnasOrderStockAuditDatabase {
  salesOrder: {
    findMany(args: unknown): Promise<AuditOrderRow[]>;
    count(args: unknown): Promise<number>;
  };
  externalReference: {
    findMany(
      args: unknown,
    ): Promise<Array<{ entityId: string; externalId: string }>>;
    groupBy(
      args: unknown,
    ): Promise<Array<{ externalId: string; _count: { externalId: number } }>>;
  };
  stockMovement: {
    findMany(args: unknown): Promise<AuditMovementRow[]>;
  };
  productVariant: {
    findMany(args: unknown): Promise<AuditVariantRow[]>;
  };
}

export const UNAS_ORDER_STOCK_AUDIT_DATABASE = Symbol(
  "UNAS_ORDER_STOCK_AUDIT_DATABASE",
);

/// Read-only data access for the historical UNAS order audit - see
/// unas-order-stock-audit.service.ts for the risk-flag computation this
/// feeds, and docs/INVENTORY-CONSISTENCY.md for why this exists (checkpoint
/// 4's own production-activation precondition). No method here ever writes
/// to SalesOrder, SalesOrderLine, StockMovement, or ExternalReference.
@Injectable()
export class UnasOrderStockAuditRepository extends Repository {
  private readonly auditDatabase: UnasOrderStockAuditDatabase;

  constructor(
    @Optional()
    @Inject(UNAS_ORDER_STOCK_AUDIT_DATABASE)
    database?: UnasOrderStockAuditDatabase,
  ) {
    super(prisma);
    this.auditDatabase =
      database ?? (prisma as unknown as UnasOrderStockAuditDatabase);
  }

  /// One page of UNAS-channel orders, each paired with its ExternalReference
  /// (if any) and its ledger-derived bookedOut - both batched across the
  /// whole page in two extra queries, never one query per order.
  async auditPage(params: { page: number; pageSize: number }): Promise<{
    orders: AuditOrderRow[];
    unasKeyByOrderId: Map<string, string>;
    bookedOutByOrderId: Map<string, Map<string, Prisma.Decimal>>;
    targetOutByOrderId: Map<string, Map<string, Prisma.Decimal>>;
    totalItems: number;
  }> {
    const where = { channel: "UNAS" } as const;
    const skip = (params.page - 1) * params.pageSize;
    const [orders, totalItems] = await Promise.all([
      this.auditDatabase.salesOrder.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          lines: {
            where: { unasRemovedAt: null },
            select: { variantId: true, quantity: true },
          },
        },
        orderBy: { id: "asc" },
        skip,
        take: params.pageSize,
      }),
      this.auditDatabase.salesOrder.count({ where }),
    ]);

    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) {
      return {
        orders,
        unasKeyByOrderId: new Map(),
        bookedOutByOrderId: new Map(),
        targetOutByOrderId: new Map(),
        totalItems,
      };
    }

    const lineVariantIds = [
      ...new Set(
        orders.flatMap((order) =>
          order.lines.flatMap((line) =>
            line.variantId ? [line.variantId] : [],
          ),
        ),
      ),
    ];
    const lineVariants =
      lineVariantIds.length > 0
        ? await this.auditDatabase.productVariant.findMany({
            where: { id: { in: lineVariantIds } },
            select: {
              id: true,
              sku: true,
              product: {
                select: {
                  catalogAuthority: true,
                  unasSnapshot: {
                    select: {
                      isPackageProduct: true,
                      packageComponents: true,
                    },
                  },
                },
              },
            },
          })
        : [];
    const packageComponentSkus = [
      ...new Set(
        lineVariants.flatMap((variant) =>
          variant.product.unasSnapshot?.isPackageProduct
            ? parseUnasPackageComponents(
                variant.product.unasSnapshot.packageComponents,
              ).map((component) => component.sku)
            : [],
        ),
      ),
    ];
    const componentVariants =
      packageComponentSkus.length > 0
        ? await this.auditDatabase.productVariant.findMany({
            where: { sku: { in: packageComponentSkus }, isActive: true },
            select: {
              id: true,
              sku: true,
              product: {
                select: {
                  catalogAuthority: true,
                  unasSnapshot: {
                    select: {
                      isPackageProduct: true,
                      packageComponents: true,
                    },
                  },
                },
              },
            },
          })
        : [];
    const lineVariantById = new Map(
      lineVariants.map((variant) => [variant.id, variant]),
    );
    const componentVariantBySku = new Map(
      componentVariants
        .filter(
          (variant) =>
            isUnasMasteredVariant(variant) &&
            !variant.product.unasSnapshot?.isPackageProduct,
        )
        .map((variant) => [variant.sku, variant]),
    );
    const targetOutByOrderId = new Map(
      orders.map((order) => [
        order.id,
        computeCurrentTargetOut(
          order.lines,
          lineVariantById,
          componentVariantBySku,
        ),
      ]),
    );

    const [references, movements] = await Promise.all([
      this.auditDatabase.externalReference.findMany({
        where: {
          system: "UNAS",
          entityType: "SalesOrder",
          entityId: { in: orderIds },
        },
        select: { entityId: true, externalId: true },
      }),
      this.auditDatabase.stockMovement.findMany({
        where: {
          referenceType: "SalesOrder",
          referenceId: { in: orderIds },
          type: { in: ["SALE", "RETURN_IN"] },
        },
        select: {
          referenceId: true,
          type: true,
          lines: { select: { variantId: true, quantity: true } },
        },
      }),
    ]);

    const unasKeyByOrderId = new Map(
      references.map((reference) => [reference.entityId, reference.externalId]),
    );

    const movementsByOrderId = new Map<string, AuditMovementRow[]>();
    for (const movement of movements) {
      if (!movement.referenceId) continue;
      const bucket = movementsByOrderId.get(movement.referenceId) ?? [];
      bucket.push(movement);
      movementsByOrderId.set(movement.referenceId, bucket);
    }
    const bookedOutByOrderId = new Map<string, Map<string, Prisma.Decimal>>();
    for (const orderId of orderIds) {
      bookedOutByOrderId.set(
        orderId,
        sumOrderBookedOut(movementsByOrderId.get(orderId) ?? []),
      );
    }

    return {
      orders,
      unasKeyByOrderId,
      bookedOutByOrderId,
      targetOutByOrderId,
      totalItems,
    };
  }

  /// Every UNAS key (ExternalReference.externalId, system="UNAS",
  /// entityType="SalesOrder") that appears on more than one local
  /// SalesOrder - cheap, bounded query (groupBy only ever returns as many
  /// rows as there are distinct keys, and duplicates should be rare/never).
  async findDuplicateUnasKeys(): Promise<
    Array<{ unasKey: string; salesOrderIds: string[] }>
  > {
    const groups = await this.auditDatabase.externalReference.groupBy({
      by: ["externalId"],
      where: { system: "UNAS", entityType: "SalesOrder" },
      _count: { externalId: true },
    });
    const duplicateKeys = groups
      .filter((group) => group._count.externalId > 1)
      .map((group) => group.externalId);
    if (duplicateKeys.length === 0) return [];

    const rows = await this.auditDatabase.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: "SalesOrder",
        externalId: { in: duplicateKeys },
      },
      select: { entityId: true, externalId: true },
    });
    const byKey = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = byKey.get(row.externalId) ?? [];
      bucket.push(row.entityId);
      byKey.set(row.externalId, bucket);
    }
    return [...byKey.entries()].map(([unasKey, salesOrderIds]) => ({
      unasKey,
      salesOrderIds,
    }));
  }

  /// Distinct StockMovement.referenceId values (SalesOrder-typed SALE/
  /// RETURN_IN movements) that don't correspond to any existing SalesOrder
  /// row - e.g. a movement left behind by a since-deleted order, or a
  /// referenceId that was never a valid order id to begin with.
  async findOrphanStockMovementReferences(): Promise<string[]> {
    // select/distinct narrow the real query to just referenceId - the
    // declared AuditMovementRow return type is a superset (also has
    // type/lines), which this call simply never reads; see this file's own
    // interface doc comment for why that's the deliberate convention here
    // rather than a separate fictional method name.
    const movements = await this.auditDatabase.stockMovement.findMany({
      where: {
        referenceType: "SalesOrder",
        type: { in: ["SALE", "RETURN_IN"] },
      },
      select: { referenceId: true },
      distinct: ["referenceId"],
    });
    const referenceIds = [
      ...new Set(
        movements
          .map((movement) => movement.referenceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (referenceIds.length === 0) return [];
    // Same narrowing convention: only `.id` is read from the result below,
    // even though salesOrder.findMany's declared return type is
    // AuditOrderRow[] (also has orderNumber/status/lines).
    const existing = await this.auditDatabase.salesOrder.findMany({
      where: { id: { in: referenceIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    return referenceIds.filter((id) => !existingIds.has(id));
  }
}

/// Per-variant "current effective target quantity" straight from a
/// persisted SalesOrderLine snapshot - deliberately NOT a live UNAS
/// re-fetch (the audit must work offline/read-only, see this module's own
/// checkpoint requirement) and deliberately NOT resolveEffectiveVariantId/
/// aggregateTargetOut from unas-order-sync.repository.ts either: those two
/// reconcile a FRESH UNAS sighting against already-persisted lines, but a
/// persisted SalesOrderLine's OWN variantId already IS the effective one
/// (an unresolved/technical-cost line is persisted with variantId=null, see
/// buildLineInputs) - so summing quantity by variantId over lines where
/// variantId is not null reproduces exactly what the live delta engine
/// would compute as targetOut for this order's CURRENT persisted state,
/// with no live lookup needed.
export function computeCurrentTargetOut(
  lines: Array<{ variantId: string | null; quantity: Prisma.Decimal }>,
  variantById: Map<string, AuditVariantRow> = new Map(),
  componentVariantBySku: Map<string, AuditVariantRow> = new Map(),
): Map<string, Prisma.Decimal> {
  const target = new Map<string, Prisma.Decimal>();
  const add = (variantId: string, quantity: Prisma.Decimal) => {
    const running = target.get(variantId) ?? new Prisma.Decimal(0);
    target.set(variantId, running.plus(quantity));
  };
  for (const line of lines) {
    if (!line.variantId) continue;
    const variant = variantById.get(line.variantId);
    if (variant?.product.unasSnapshot?.isPackageProduct) {
      const components = parseUnasPackageComponents(
        variant.product.unasSnapshot.packageComponents,
      );
      const resolved = components.flatMap((component) => {
        const componentVariant = componentVariantBySku.get(component.sku);
        return componentVariant
          ? [{ variantId: componentVariant.id, qty: component.qty }]
          : [];
      });
      if (components.length > 0 && resolved.length === components.length) {
        for (const component of resolved) {
          add(component.variantId, line.quantity.times(component.qty));
        }
        continue;
      }
      // Preserve the old package target as a visible anomaly when package
      // metadata is incomplete; silently dropping it would make the audit
      // claim the order has no stock target at all.
    }
    add(line.variantId, line.quantity);
  }
  return target;
}

export function computeRiskFlags(params: {
  status: string;
  unasKey: string | null;
  targetOut: Map<string, Prisma.Decimal>;
  bookedOut: Map<string, Prisma.Decimal>;
}): UnasOrderAuditRiskFlag[] {
  const flags: UnasOrderAuditRiskFlag[] = [];
  if (!params.unasKey) flags.push("MISSING_EXTERNAL_REFERENCE");

  for (const [, quantity] of params.bookedOut) {
    if (quantity.isNegative()) {
      flags.push("NEGATIVE_BOOKED_QUANTITY");
      break;
    }
  }

  if (params.status !== "CANCELLED") {
    let zeroBooked = false;
    for (const [variantId, target] of params.targetOut) {
      if (target.isZero() || target.isNegative()) continue;
      const booked = params.bookedOut.get(variantId) ?? new Prisma.Decimal(0);
      if (booked.isZero()) {
        zeroBooked = true;
        break;
      }
    }
    if (zeroBooked) flags.push("ACTIVE_ORDER_ZERO_BOOKED");
  } else {
    let positiveBooked = false;
    for (const [, quantity] of params.bookedOut) {
      // Prisma.Decimal's own isPositive() is "not negative" (decimal.js
      // convention: 0 counts as positive), which silently flagged every
      // cancelled order whose bookedOut had already correctly drained to
      // exactly zero. This flag is specifically about a cancelled order
      // that STILL holds booked stock it should have released - a
      // strictly-greater-than-zero check, not "non-negative".
      if (quantity.greaterThan(0)) {
        positiveBooked = true;
        break;
      }
    }
    if (positiveBooked) flags.push("CANCELLED_ORDER_POSITIVE_BOOKED");
  }

  return flags;
}
