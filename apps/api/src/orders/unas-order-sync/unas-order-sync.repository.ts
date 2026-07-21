import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  StockReconciliationReport,
  UnasApiOrder,
  UnasOrderDetail,
  UnasOrderListResponse,
  UnasOrderSyncRun,
  UnasOrderSyncSummary,
} from "@acropora/types";

import { setStockItemQuantity } from "../../common/stock-item-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../../common/warehouse.util.js";
import type { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { mapUnasOrderStatus } from "./unas-order-status.mapper.js";
import {
  toUnasOrderDetail,
  toUnasOrderListItem,
  type SalesOrderListWithRelations,
  type SalesOrderWithRelations,
} from "./unas-order-sync.types.js";

const ACTIVE_SYNC_KEY = "UNAS_ORDERS";
const STALE_RUN_AFTER_MS = 15 * 60_000;
const RECONCILIATION_EPSILON = "0.001";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const detailInclude = { lines: true } as const;
const listInclude = { _count: { select: { lines: true } } } as const;

interface ExternalReferenceRow {
  id: string;
  entityId: string;
}

interface OrderLineRow {
  id: string;
  variantId: string | null;
  quantity: Prisma.Decimal;
  syncStatus: string;
}

interface OrderRow {
  id: string;
  status: string;
  lines: OrderLineRow[];
}

interface UnasOrderSyncTransaction extends WarehouseLookupDatabase {
  stockItem: {
    findFirst(
      args: unknown,
    ): Promise<{ id: string; onHand: Prisma.Decimal } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  productVariant: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  salesOrder: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<OrderRow | null>;
  };
  stockMovement: {
    create(args: unknown): Promise<{ id: string }>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
  };
  unasOrderSyncRun: {
    updateMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string }>;
    findUniqueOrThrow(args: unknown): Promise<{ status: string }>;
    update(args: unknown): Promise<unknown>;
  };
  integrationCursor: {
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface UnasOrderSyncDatabase {
  unasOrderSyncRun: {
    updateMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string }>;
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  integrationCursor: {
    findUnique(
      args: unknown,
    ): Promise<{ lastSuccessfulWindowEnd: Date | null } | null>;
  };
  salesOrder: {
    findMany(args: unknown): Promise<SalesOrderListWithRelations[]>;
    findUnique(args: unknown): Promise<SalesOrderWithRelations | null>;
    count(args: unknown): Promise<number>;
  };
  product: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        name: string;
        unasSnapshot: {
          reportedStock: Prisma.Decimal | null;
          reportedStockSyncedAt: Date | null;
        } | null;
        variants: Array<{ id: string; sku: string }>;
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  $transaction<T>(
    operation: (transaction: UnasOrderSyncTransaction) => Promise<T>,
    options?: unknown,
  ): Promise<T>;
}

export const UNAS_ORDER_SYNC_DATABASE = Symbol("UNAS_ORDER_SYNC_DATABASE");

function toRunView(run: {
  id: string;
  status: string;
  windowStart: Date | null;
  windowEnd: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  ordersSeen: number;
  createdCount: number;
  updatedCount: number;
  reversedCount: number;
  stockMismatchCount: number;
  errorCode: string | null;
}): UnasOrderSyncRun {
  return {
    id: run.id,
    status: run.status as UnasOrderSyncRun["status"],
    windowStart: run.windowStart?.toISOString() ?? null,
    windowEnd: run.windowEnd.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    ordersSeen: run.ordersSeen,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    reversedCount: run.reversedCount,
    stockMismatchCount: run.stockMismatchCount,
    errorCode: run.errorCode,
  };
}

@Injectable()
export class UnasOrderSyncRepository extends Repository {
  private readonly syncDatabase: UnasOrderSyncDatabase;

  constructor(
    @Optional()
    @Inject(UNAS_ORDER_SYNC_DATABASE)
    database?: UnasOrderSyncDatabase,
  ) {
    super(prisma);
    this.syncDatabase =
      database ?? (prisma as unknown as UnasOrderSyncDatabase);
  }

  async getCursor(): Promise<Date | null> {
    const cursor = await this.syncDatabase.integrationCursor.findUnique({
      where: { provider_stream: { provider: "UNAS", stream: "ORDERS" } },
    });
    return cursor?.lastSuccessfulWindowEnd ?? null;
  }

  async createRun(input: {
    windowStart: Date | null;
    windowEnd: Date;
  }): Promise<string> {
    try {
      const run = await this.syncDatabase.$transaction(async (transaction) => {
        await transaction.unasOrderSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "UNAS_ORDER_SYNC_STALE",
          },
        });
        return transaction.unasOrderSyncRun.create({
          data: {
            ...input,
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            startedAt: new Date(),
          },
        });
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("UNAS_ORDER_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async markFailed(runId: string, errorCode: string): Promise<void> {
    await this.syncDatabase.unasOrderSyncRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        activeKey: null,
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode.slice(0, 200),
      },
    });
  }

  async getRun(runId: string): Promise<UnasOrderSyncRun> {
    const run = await this.syncDatabase.unasOrderSyncRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException("UNAS_ORDER_SYNC_RUN_NOT_FOUND");
    return toRunView(run as Parameters<typeof toRunView>[0]);
  }

  async listRuns(limit: number): Promise<UnasOrderSyncRun[]> {
    const runs = await this.syncDatabase.unasOrderSyncRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return runs.map((run) => toRunView(run as Parameters<typeof toRunView>[0]));
  }

  /// Idempotently applies a batch of UNAS orders: new orders create a
  /// SalesOrder + a SALE stock movement (decrementing on-hand); orders that
  /// newly transition to a cancelled/failed status get a one-time RETURN_IN
  /// reversal; anything else just refreshes the mirrored status. Guards
  /// against re-processing the same UNAS Key twice via ExternalReference,
  /// and against double-reversal via an existing RETURN_IN movement check -
  /// both matter because TimeModStart re-surfaces an order on every poll
  /// until a newer windowEnd passes it by.
  async apply(
    runId: string,
    orders: readonly UnasApiOrder[],
    windowStart: Date | null,
    windowEnd: Date,
  ): Promise<UnasOrderSyncSummary> {
    return this.syncDatabase.$transaction(
      async (transaction) => {
        const run = await transaction.unasOrderSyncRun.findUniqueOrThrow({
          where: { id: runId },
        });
        if (run.status !== "RUNNING")
          throw new Error(`INVALID_ORDER_SYNC_RUN_STATE:${run.status}`);

        const warehouse = await ensureMainWarehouse(transaction);
        let createdCount = 0;
        let updatedCount = 0;
        let reversedCount = 0;

        for (const order of orders) {
          const reference = await transaction.externalReference.findUnique({
            where: {
              system_entityType_externalId: {
                system: "UNAS",
                entityType: "SalesOrder",
                externalId: order.key,
              },
            },
          });

          if (!reference) {
            await this.createNewOrder(transaction, order, warehouse.id);
            createdCount += 1;
            continue;
          }

          const existing = await transaction.salesOrder.findUnique({
            where: { id: reference.entityId },
            select: {
              id: true,
              status: true,
              lines: {
                select: {
                  id: true,
                  variantId: true,
                  quantity: true,
                  syncStatus: true,
                },
              },
            },
          });
          if (!existing) continue; // Order row missing locally; nothing safe to reconcile against.

          const newStatus = mapUnasOrderStatus(order.statusType);
          if (newStatus === "CANCELLED" && existing.status !== "CANCELLED") {
            await this.reverseOrder(transaction, existing, warehouse.id);
            reversedCount += 1;
          } else if (newStatus !== existing.status) {
            await transaction.salesOrder.update({
              where: { id: existing.id },
              data: { status: newStatus },
            });
            updatedCount += 1;
          }

          await transaction.externalReference.update({
            where: { id: reference.id },
            data: {
              metadata: json({
                unasStatus: order.status,
                unasStatusType: order.statusType,
              }),
              lastSyncedAt: windowEnd,
            },
          });
        }

        await transaction.integrationCursor.upsert({
          where: { provider_stream: { provider: "UNAS", stream: "ORDERS" } },
          create: {
            provider: "UNAS",
            stream: "ORDERS",
            lastSuccessfulWindowEnd: windowEnd,
          },
          update: { lastSuccessfulWindowEnd: windowEnd },
        });
        await transaction.unasOrderSyncRun.update({
          where: { id: runId },
          data: {
            activeKey: null,
            status: "APPLIED",
            completedAt: new Date(),
            ordersSeen: orders.length,
            createdCount,
            updatedCount,
            reversedCount,
          },
        });

        return {
          runId,
          status: "APPLIED" as const,
          ordersSeen: orders.length,
          createdCount,
          updatedCount,
          reversedCount,
          stockMismatchCount: 0,
          windowStart: windowStart?.toISOString() ?? null,
          windowEnd: windowEnd.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
      },
    );
  }

  async recordStockMismatchCount(
    runId: string,
    stockMismatchCount: number,
  ): Promise<void> {
    await this.syncDatabase.unasOrderSyncRun.updateMany({
      where: { id: runId },
      data: { stockMismatchCount },
    });
  }

  private async createNewOrder(
    transaction: UnasOrderSyncTransaction,
    order: UnasApiOrder,
    warehouseId: string,
  ): Promise<void> {
    let totalNet = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);
    const lineInputs: Array<{
      variantId: string | null;
      sku: string;
      description: string;
      quantity: Prisma.Decimal;
      unit: string;
      unitNet: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineGross: Prisma.Decimal;
      syncStatus: "OK" | "FAILED";
      syncError: string | null;
    }> = [];
    const stockLines: Array<{ variantId: string; quantity: Prisma.Decimal }> =
      [];

    for (const item of order.items) {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitNet = new Prisma.Decimal(item.priceNet ?? "0");
      const taxRate = new Prisma.Decimal(item.vatRate ?? "0");
      const lineGross = new Prisma.Decimal(item.priceGross ?? "0").times(
        quantity,
      );
      totalNet = totalNet.plus(unitNet.times(quantity));
      totalGross = totalGross.plus(lineGross);

      if (!item.sku) {
        // Non-stock line (shipping-cost, discount-amount, etc.): counts
        // toward the order total but never toward stock.
        lineInputs.push({
          variantId: null,
          sku: item.id,
          description: item.name,
          quantity,
          unit: item.unit ?? "db",
          unitNet,
          taxRate,
          lineGross,
          syncStatus: "OK",
          syncError: null,
        });
        continue;
      }

      const variant = await transaction.productVariant.findFirst({
        where: { sku: item.sku },
        select: { id: true },
      });
      if (!variant) {
        lineInputs.push({
          variantId: null,
          sku: item.sku,
          description: item.name,
          quantity,
          unit: item.unit ?? "db",
          unitNet,
          taxRate,
          lineGross,
          syncStatus: "FAILED",
          syncError: `UNKNOWN_SKU:${item.sku}`,
        });
        continue;
      }

      lineInputs.push({
        variantId: variant.id,
        sku: item.sku,
        description: item.name,
        quantity,
        unit: item.unit ?? "db",
        unitNet,
        taxRate,
        lineGross,
        syncStatus: "OK",
        syncError: null,
      });
      stockLines.push({ variantId: variant.id, quantity });
    }

    const orderRow = await transaction.salesOrder.create({
      data: {
        orderNumber: `UNAS-${order.key}`,
        channel: "UNAS",
        status: mapUnasOrderStatus(order.statusType),
        currency: order.currency ?? "HUF",
        warehouseId,
        buyerName: order.customerName,
        buyerEmail: order.customerEmail,
        totalNet,
        totalTax: totalGross.minus(totalNet),
        totalGross,
        orderedAt: order.orderedAt ? new Date(order.orderedAt) : null,
        lines: { create: lineInputs },
      },
    });

    if (stockLines.length > 0) {
      const movement = await transaction.stockMovement.create({
        data: {
          movementNumber: `WEBSHOP-${order.key}`,
          type: "SALE",
          status: "POSTED",
          sourceWarehouseId: warehouseId,
          referenceType: "SalesOrder",
          referenceId: orderRow.id,
          occurredAt: new Date(),
          postedAt: new Date(),
        },
      });
      for (const line of stockLines) {
        await transaction.stockMovementLine.create({
          data: {
            movementId: movement.id,
            variantId: line.variantId,
            quantity: line.quantity,
            unit: "db",
          },
        });
        const current = await transaction.stockItem.findFirst({
          where: {
            variantId: line.variantId,
            warehouseId,
            locationId: null,
            lotId: null,
          },
          select: { id: true, onHand: true },
        });
        const resultingQty = (current?.onHand ?? new Prisma.Decimal(0)).minus(
          line.quantity,
        );
        await setStockItemQuantity(transaction, {
          variantId: line.variantId,
          warehouseId,
          onHand: resultingQty,
        });
      }
    }

    await transaction.externalReference.create({
      data: {
        system: "UNAS",
        entityType: "SalesOrder",
        entityId: orderRow.id,
        externalId: order.key,
        externalKey: order.key,
        metadata: json({
          unasStatus: order.status,
          unasStatusType: order.statusType,
        }),
        lastSyncedAt: new Date(),
      },
    });
  }

  private async reverseOrder(
    transaction: UnasOrderSyncTransaction,
    order: OrderRow,
    warehouseId: string,
  ): Promise<void> {
    const alreadyReversed = await transaction.stockMovement.findFirst({
      where: {
        type: "RETURN_IN",
        referenceType: "SalesOrder",
        referenceId: order.id,
      },
      select: { id: true },
    });
    const stockLines = order.lines.filter(
      (line) => line.variantId && line.syncStatus === "OK",
    );
    if (!alreadyReversed && stockLines.length > 0) {
      const movement = await transaction.stockMovement.create({
        data: {
          movementNumber: `WEBSHOP-CANCEL-${order.id}`,
          type: "RETURN_IN",
          status: "POSTED",
          targetWarehouseId: warehouseId,
          referenceType: "SalesOrder",
          referenceId: order.id,
          occurredAt: new Date(),
          postedAt: new Date(),
        },
      });
      for (const line of stockLines) {
        await transaction.stockMovementLine.create({
          data: {
            movementId: movement.id,
            variantId: line.variantId!,
            quantity: line.quantity,
            unit: "db",
          },
        });
        const current = await transaction.stockItem.findFirst({
          where: {
            variantId: line.variantId!,
            warehouseId,
            locationId: null,
            lotId: null,
          },
          select: { id: true, onHand: true },
        });
        const resultingQty = (current?.onHand ?? new Prisma.Decimal(0)).plus(
          line.quantity,
        );
        await setStockItemQuantity(transaction, {
          variantId: line.variantId!,
          warehouseId,
          onHand: resultingQty,
        });
      }
    }
    await transaction.salesOrder.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });
  }

  async list(query: UnasOrderListQueryDto): Promise<UnasOrderListResponse> {
    const where = { channel: "UNAS" } as const;
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.syncDatabase.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      this.syncDatabase.salesOrder.count({ where }),
    ]);
    return {
      items: items.map(toUnasOrderListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<UnasOrderDetail | null> {
    const order = await this.syncDatabase.salesOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    return order ? toUnasOrderDetail(order) : null;
  }

  /// Pure read, no UNAS call: compares StockItem.onHand against the
  /// UnasProductSnapshot.reportedStock already kept fresh by the product
  /// sync job. A variant with no snapshot (not UNAS-mirrored, e.g. a
  /// purely local product) is skipped rather than flagged. Just as
  /// importantly: a variant with NO StockItem row at all (never touched by
  /// a leltár or a POS/webshop sale - StockItem rows are created lazily,
  /// see its own model comment) is also skipped rather than treated as a
  /// confirmed "0 in stock". Most of the catalog can go untouched locally
  /// for a long time; without this, every one of those products would
  /// falsely show up as a mismatch against whatever UNAS reports.
  async findStockDiscrepancies(): Promise<StockReconciliationReport> {
    const products = await this.syncDatabase.product.findMany({
      where: { unasSnapshot: { reportedStock: { not: null } } },
      select: {
        id: true,
        name: true,
        unasSnapshot: {
          select: { reportedStock: true, reportedStockSyncedAt: true },
        },
        variants: {
          select: { id: true, sku: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
        },
      },
    });
    const variantIds = products
      .map((product) => product.variants[0]?.id)
      .filter((id): id is string => Boolean(id));
    const stockItems = await this.syncDatabase.stockItem.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map<string, Prisma.Decimal>();
    for (const item of stockItems) {
      const running =
        onHandByVariant.get(item.variantId) ?? new Prisma.Decimal(0);
      onHandByVariant.set(item.variantId, running.plus(item.onHand));
    }

    const epsilon = new Prisma.Decimal(RECONCILIATION_EPSILON);
    const trackedProducts = products.filter((product) => {
      const variant = product.variants[0];
      return variant && onHandByVariant.has(variant.id);
    });
    const mismatches = trackedProducts.flatMap((product) => {
      const variant = product.variants[0];
      const reportedStock = product.unasSnapshot?.reportedStock;
      if (!variant || reportedStock === null || reportedStock === undefined)
        return [];
      const localOnHand = onHandByVariant.get(variant.id)!;
      const difference = localOnHand.minus(reportedStock);
      if (difference.abs().lessThanOrEqualTo(epsilon)) return [];
      return [
        {
          variantId: variant.id,
          sku: variant.sku,
          productName: product.name,
          localOnHand: localOnHand.toString(),
          unasReportedStock: reportedStock.toString(),
          difference: difference.toString(),
          reportedStockSyncedAt:
            product.unasSnapshot?.reportedStockSyncedAt?.toISOString() ?? null,
        },
      ];
    });

    return {
      checkedAt: new Date().toISOString(),
      checkedCount: trackedProducts.length,
      mismatches,
    };
  }
}
