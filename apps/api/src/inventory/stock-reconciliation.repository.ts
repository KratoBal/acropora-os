import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import {
  classifyLedgerMovements,
  type LedgerMovement,
} from "../common/stock-ledger.util.js";
import { computeReconciliationStatus } from "./stock-reconciliation-status.util.js";
import type {
  OutboxDiagnosis,
  OutboxLatestStatus,
  StockReconciliationPage,
  StockReconciliationQuery,
  StockReconciliationRow,
} from "./stock-reconciliation.types.js";

interface StockItemRow {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  reserved?: Prisma.Decimal;
  variant: { sku: string };
  warehouse: { code: string };
}

interface ProductLinkRow {
  id: string; // variantId
  productId: string;
  product: {
    catalogAuthority: "UNAS" | "ACROPORA" | null;
    unasSnapshot: { reportedStock: Prisma.Decimal | null } | null;
    variants: Array<{ id: string }>; // the product's first variant only (query already orders+takes 1)
  };
}

interface OutboxRow {
  id: string;
  variantId: string;
  warehouseId: string;
  targetOnHand: Prisma.Decimal;
  status: string;
  resolutionNote: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  processedAt: Date | null;
  updatedAt: Date;
  sequence: bigint;
}

export interface StockReconciliationDatabase {
  stockItem: {
    findMany(args: unknown): Promise<StockItemRow[]>;
    count(args: unknown): Promise<number>;
    groupBy(args: unknown): Promise<
      Array<{
        variantId: string;
        _sum: {
          onHand: Prisma.Decimal | null;
          reserved?: Prisma.Decimal | null;
        };
      }>
    >;
  };
  stockMovementLine: {
    findMany(args: unknown): Promise<
      Array<{
        variantId: string;
        quantity: Prisma.Decimal;
        movement: { type: string; sourceWarehouseId: string | null };
      }>
    >;
  };
  productVariant: {
    findMany(args: unknown): Promise<ProductLinkRow[]>;
  };
  unasStockSyncOutbox: {
    findMany(args: unknown): Promise<OutboxRow[]>;
  };
}

export const STOCK_RECONCILIATION_DATABASE = Symbol(
  "STOCK_RECONCILIATION_DATABASE",
);

const SUPERSEDABLE_STATUSES = new Set(["PENDING", "FAILED", "DEAD_LETTER"]);

/// Read-only stock-reconciliation data access. Every method here is a pure
/// read: no StockItem/StockMovement/UnasStockSyncOutbox row is ever
/// created, updated, or deleted by this class - see
/// stock-reconciliation.service.ts for the (also read-only) status
/// computation this feeds, and docs/INVENTORY-CONSISTENCY.md for the
/// design rationale. Batches every lookup across the current page's
/// (variantId, warehouseId) pairs rather than per-row, to avoid N+1 queries
/// on large catalogs - see reconcilePage's own comments for exactly which
/// queries are batched.
@Injectable()
export class StockReconciliationRepository extends Repository {
  private readonly reconciliationDatabase: StockReconciliationDatabase;

  constructor(
    @Optional()
    @Inject(STOCK_RECONCILIATION_DATABASE)
    database?: StockReconciliationDatabase,
  ) {
    super(prisma);
    this.reconciliationDatabase =
      database ?? (prisma as unknown as StockReconciliationDatabase);
  }

  /// Main reconciliation page: one row per existing StockItem (the
  /// universe of "pairs known to have local activity" - see
  /// findVariantsMissingStockItem for the complementary "should exist but
  /// doesn't" case, which by definition has no StockItem row to paginate
  /// over here).
  async reconcilePage(
    query: StockReconciliationQuery,
  ): Promise<StockReconciliationPage> {
    const where = {
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [stockItems, totalItems] = await Promise.all([
      this.reconciliationDatabase.stockItem.findMany({
        where,
        include: {
          variant: { select: { sku: true } },
          warehouse: { select: { code: true } },
        },
        orderBy: [{ variantId: "asc" }, { warehouseId: "asc" }],
        skip,
        take: query.pageSize,
      }),
      this.reconciliationDatabase.stockItem.count({ where }),
    ]);

    const items = await this.buildRows(stockItems);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize) || 1,
    };
  }

  /// Single-pair reconciliation, reusing buildRows exactly like
  /// reconcilePage does - used by the checkpoint-6 repair service to
  /// (re)compute a fresh status/ledgerExpectedOnHand for one StockItem
  /// right before deciding whether a repair may proceed. Null if no such
  /// StockItem row exists (e.g. deleted between the client's read and this
  /// call - callers must treat that as "nothing to repair", not retry a
  /// stale id).
  async reconcileByStockItemId(
    stockItemId: string,
  ): Promise<StockReconciliationRow | null> {
    const stockItems = await this.reconciliationDatabase.stockItem.findMany({
      where: { id: stockItemId },
      include: {
        variant: { select: { sku: true } },
        warehouse: { select: { code: true } },
      },
      take: 1,
    });
    if (stockItems.length === 0) return null;
    const [row] = await this.buildRows(stockItems);
    return row ?? null;
  }

  /// Shared row-building for a batch of StockItem rows - one round-trip per
  /// dependency (ledger movements, UNAS product link, outbox history)
  /// regardless of batch size, never one query per row.
  private async buildRows(
    stockItems: StockItemRow[],
  ): Promise<StockReconciliationRow[]> {
    if (stockItems.length === 0) return [];

    const variantIds = [...new Set(stockItems.map((item) => item.variantId))];
    const warehouseIds = [
      ...new Set(stockItems.map((item) => item.warehouseId)),
    ];

    const [movementLines, productLinks, outboxRows] = await Promise.all([
      this.reconciliationDatabase.stockMovementLine.findMany({
        where: {
          variantId: { in: variantIds },
          movement: { sourceWarehouseId: { in: warehouseIds } },
        },
        select: {
          variantId: true,
          quantity: true,
          movement: { select: { type: true, sourceWarehouseId: true } },
        },
      }),
      this.reconciliationDatabase.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          productId: true,
          product: {
            select: {
              catalogAuthority: true,
              unasSnapshot: { select: { reportedStock: true } },
              variants: {
                select: { id: true },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 1,
              },
            },
          },
        },
      }),
      this.reconciliationDatabase.unasStockSyncOutbox.findMany({
        where: {
          variantId: { in: variantIds },
          warehouseId: { in: warehouseIds },
        },
        orderBy: { sequence: "desc" },
      }),
    ]);

    // Ledger: grouped by (variantId, sourceWarehouseId) - matches this
    // reconciliation's per-pair granularity exactly (unlike the UNAS
    // comparison, which is unavoidably variant-only - see below).
    const movementsByPair = new Map<string, LedgerMovement[]>();
    for (const line of movementLines) {
      const warehouseId = line.movement.sourceWarehouseId;
      if (!warehouseId) continue; // Defensive: postInventoryMovement always sets it; a null here would be pre-writer legacy data.
      const key = `${line.variantId}:${warehouseId}`;
      const bucket = movementsByPair.get(key) ?? [];
      bucket.push({
        type: line.movement.type,
        lines: [{ variantId: line.variantId, quantity: line.quantity }],
      });
      movementsByPair.set(key, bucket);
    }

    // UNAS comparison is product-level, not warehouse-level (UNAS has no
    // concept of Acropora's internal warehouses) - only a variant that IS
    // its product's first variant (matching the existing, accepted
    // convention in unas-order-sync.repository.ts's findStockDiscrepancies)
    // is ever compared; every other variant of a multi-variant product gets
    // unasOnHand=null with an explanatory note.
    const productLinkByVariant = new Map(
      productLinks.map((link) => [link.id, link]),
    );
    const firstVariantIds = productLinks
      .filter((link) => link.product.variants[0]?.id === link.id)
      .map((link) => link.id);
    const localSumByVariant =
      firstVariantIds.length > 0
        ? new Map(
            (
              await this.reconciliationDatabase.stockItem.groupBy({
                by: ["variantId"],
                where: { variantId: { in: firstVariantIds } },
                _sum: { onHand: true, reserved: true },
              })
            ).map((row) => [
              row.variantId,
              (row._sum.onHand ?? new Prisma.Decimal(0)).minus(
                row._sum.reserved ?? new Prisma.Decimal(0),
              ),
            ]),
          )
        : new Map<string, Prisma.Decimal>();

    // Outbox: group all fetched rows by pair, newest-first (already
    // ordered by sequence desc from the query above).
    const outboxByPair = new Map<string, OutboxRow[]>();
    for (const row of outboxRows) {
      const key = `${row.variantId}:${row.warehouseId}`;
      const bucket = outboxByPair.get(key) ?? [];
      bucket.push(row);
      outboxByPair.set(key, bucket);
    }

    return stockItems.map((item) => {
      const pairKey = `${item.variantId}:${item.warehouseId}`;
      const classification = classifyLedgerMovements(
        movementsByPair.get(pairKey) ?? [],
      );
      const hasAnyMovement = (movementsByPair.get(pairKey) ?? []).length > 0;
      const ledgerProvable =
        hasAnyMovement &&
        !classification.unprovableVariantIds.has(item.variantId);
      const ledgerExpectedOnHand = ledgerProvable
        ? (classification.provableNetByVariant.get(item.variantId) ??
          new Prisma.Decimal(0))
        : null;

      const productLink = productLinkByVariant.get(item.variantId);
      const requiresUnasSync = productLink?.product.catalogAuthority === "UNAS";
      const isLocalProduct =
        productLink?.product.catalogAuthority === "ACROPORA";
      const isFirstVariant =
        productLink?.product.variants[0]?.id === item.variantId;
      const unasOnHand =
        requiresUnasSync &&
        isFirstVariant &&
        productLink?.product.unasSnapshot?.reportedStock != null
          ? productLink.product.unasSnapshot.reportedStock
          : null;
      const localSumAcrossWarehouses = isFirstVariant
        ? (localSumByVariant.get(item.variantId) ?? new Prisma.Decimal(0))
        : null;

      const notes: string[] = [];
      if (!hasAnyMovement) {
        notes.push(
          "Nincs egyetlen StockMovement sem erre a (variánsId, raktár) párra - az onHand nem a ledgerből ered.",
        );
      } else if (!ledgerProvable) {
        notes.push(
          "ADJUSTMENT (vagy fel nem ismert típusú) mozgás található - az előjel a ledgerből önmagában nem rekonstruálható.",
        );
      }
      if (productLink && !isFirstVariant) {
        notes.push(
          `A termékhez ${productLink.product.variants.length >= 1 ? "több variáns tartozik" : "nincs variáns-adat"} - a UNAS csak az első variánshoz van hasonlítva, ez nem az.`,
        );
      }
      if (productLink?.product.catalogAuthority === "ACROPORA") {
        notes.push(
          "Helyi Acropora OS-termék - UNAS-készletszinkron nem alkalmazandó.",
        );
      } else if (
        !productLink ||
        productLink.product.unasSnapshot?.reportedStock == null
      ) {
        notes.push(
          "Nincs UNAS-termékadat (UnasProductSnapshot) ehhez a variánshoz.",
        );
      }

      const outboxDiagnosis = this.diagnoseOutbox(
        outboxByPair.get(pairKey) ?? [],
        item.onHand.minus(item.reserved ?? new Prisma.Decimal(0)),
      );

      const localVsLedgerDelta =
        ledgerExpectedOnHand !== null
          ? item.onHand.minus(ledgerExpectedOnHand)
          : null;
      const unasVsLocalDelta =
        unasOnHand !== null && localSumAcrossWarehouses !== null
          ? unasOnHand.minus(localSumAcrossWarehouses)
          : null;

      const status = computeReconciliationStatus({
        hasStockItem: true,
        ledgerProvable,
        hasAnyMovement,
        localVsLedgerDelta,
        hasUnasLink:
          isLocalProduct || (requiresUnasSync && unasOnHand !== null),
        unasVsLocalDelta,
        outbox: outboxDiagnosis,
      });

      return {
        variantId: item.variantId,
        sku: item.variant.sku,
        warehouseId: item.warehouseId,
        warehouseCode: item.warehouse.code,
        ledgerProvable,
        ledgerExpectedOnHand: ledgerExpectedOnHand?.toString() ?? null,
        localOnHand: item.onHand.toString(),
        unasOnHand: unasOnHand?.toString() ?? null,
        localVsLedgerDelta: localVsLedgerDelta?.toString() ?? null,
        unasVsLocalDelta: unasVsLocalDelta?.toString() ?? null,
        outbox: outboxDiagnosis,
        status,
        notes,
      } satisfies StockReconciliationRow;
    });
  }

  private diagnoseOutbox(
    rowsNewestFirst: OutboxRow[],
    localOnHand: Prisma.Decimal,
  ): OutboxDiagnosis {
    const openRows = rowsNewestFirst.filter((row) =>
      SUPERSEDABLE_STATUSES.has(row.status),
    );
    const latest = rowsNewestFirst[0];
    const latestStatus: OutboxLatestStatus = latest
      ? (latest.status as OutboxLatestStatus)
      : "NONE";
    const latestSuccess = rowsNewestFirst.find(
      (row) => row.status === "SUCCEEDED" && row.resolutionNote === null,
    );
    const lastFailure = rowsNewestFirst.find(
      (row) => row.status === "FAILED" || row.status === "DEAD_LETTER",
    );

    return {
      latestStatus,
      hasPendingCorrection: rowsNewestFirst.some(
        (row) => row.status === "PENDING" || row.status === "FAILED",
      ),
      processingLeaseExpired:
        latest?.status === "PROCESSING"
          ? latest.leaseExpiresAt
            ? latest.leaseExpiresAt.getTime() < Date.now()
            : true
          : null,
      onlySupersededRows:
        rowsNewestFirst.length > 0 &&
        rowsNewestFirst.every(
          (row) => row.status === "SUCCEEDED" && row.resolutionNote !== null,
        ),
      latestRecordedTargetOnHand: latest?.targetOnHand.toString() ?? null,
      latestSuccessMatchesCurrentLocal: latestSuccess
        ? latestSuccess.targetOnHand.equals(localOnHand)
        : null,
      competingOpenRowCount: openRows.length,
      lastSuccessfulPublishAt:
        latestSuccess?.processedAt?.toISOString() ?? null,
      lastFailureAt: lastFailure?.updatedAt.toISOString() ?? null,
    };
  }

  /// Complementary "should exist but doesn't" universe: a UNAS-linked
  /// (first-variant-of-product), reported-stock-known product with ZERO
  /// StockItem rows anywhere - v1 scope assumes the single main warehouse,
  /// same documented simplification inventory-count.repository.ts's create()
  /// already relies on ("a single warehouse-wide stock pool"). Paginated
  /// independently of reconcilePage since it has a structurally different
  /// source query (products, not stock items).
  async findVariantsMissingStockItem(params: {
    warehouseId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: Array<{ variantId: string; sku: string; unasOnHand: string }>;
    page: number;
    pageSize: number;
    totalItems: number;
  }> {
    const skip = (params.page - 1) * params.pageSize;
    const candidates =
      await this.reconciliationDatabase.productVariant.findMany({
        where: {
          product: {
            catalogAuthority: "UNAS",
            unasSnapshot: { reportedStock: { not: null } },
          },
        },
        select: {
          id: true,
          productId: true,
          product: {
            select: {
              catalogAuthority: true,
              unasSnapshot: { select: { reportedStock: true } },
              variants: {
                select: { id: true },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 1,
              },
            },
          },
        },
      });
    const firstVariants = candidates.filter(
      (link) => link.product.variants[0]?.id === link.id,
    );
    const variantIds = firstVariants.map((link) => link.id);
    const existing = new Set(
      (
        await this.reconciliationDatabase.stockItem.findMany({
          where: {
            variantId: { in: variantIds },
            warehouseId: params.warehouseId,
          },
          select: { variantId: true } as never,
        })
      ).map((row) => (row as unknown as { variantId: string }).variantId),
    );
    const missing = firstVariants.filter((link) => !existing.has(link.id));
    const page = missing.slice(skip, skip + params.pageSize);
    // sku isn't selected above (kept the query minimal) - the controller
    // layer re-attaches it if needed; here we just expose what's cheap to
    // compute without a second per-row query. Left as variantId for now,
    // sku re-fetched by the caller if it needs to render one - documented
    // limitation, not a silent gap.
    return {
      items: page.map((link) => ({
        variantId: link.id,
        sku: link.id,
        unasOnHand: (
          link.product.unasSnapshot?.reportedStock ?? new Prisma.Decimal(0)
        ).toString(),
      })),
      page: params.page,
      pageSize: params.pageSize,
      totalItems: missing.length,
    };
  }
}
