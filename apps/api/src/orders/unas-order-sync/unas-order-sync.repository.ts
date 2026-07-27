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
  type UnasOrderMetadata,
} from "./unas-order-sync.types.js";

const ACTIVE_SYNC_KEY = "UNAS_ORDERS";
const STALE_RUN_AFTER_MS = 15 * 60_000;
const RECONCILIATION_EPSILON = "0.001";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

// invoices: only the fields the order-detail view actually renders (see
// UnasOrderInvoiceSummary and toUnasOrderDetail) - not amounts/dates,
// which are always null on a source=UNAS Invoice row anyway (the UNAS
// getOrder API never provides them, see Invoice.netAmount's doc-comment
// in schema.prisma). orderBy so a future multi-invoice order (see
// Invoice.salesOrderId's doc-comment re: correction/storno rows) renders
// most-recent-first without the frontend having to sort.
const detailInclude = {
  lines: true,
  invoices: {
    select: {
      id: true,
      invoiceNumber: true,
      externalUrl: true,
      syncStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} as const;
const listInclude = { _count: { select: { lines: true } } } as const;

interface ExternalReferenceRow {
  id: string;
  entityId: string;
}

interface OrderLineRow {
  id: string;
  sku: string;
  variantId: string | null;
  quantity: Prisma.Decimal;
  syncStatus: string;
}

interface OrderRow {
  id: string;
  status: string;
  unasInvoiceStatus: string | null;
  lines: OrderLineRow[];
}

interface LineInput {
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
  /// True for UNAS's own technical cost/discount line items (see
  /// isTechnicalCostItem below) - carried alongside the row instead of
  /// re-derived from variantId/syncStatus in syncLines(), because a
  /// variantId===null + syncStatus==="OK" row is ALSO what a genuine
  /// no-SKU special line already looks like, and (before this field
  /// existed) so would a syncStatus==="FAILED" UNKNOWN_SKU row that syncLines
  /// must NOT be silently reclassified as non-stock - only an item this
  /// function positively identified as a technical cost line should ever
  /// force an existing line back to non-stock in syncLines().
  isTechnicalCost: boolean;
}

/// UNAS's own documented special Items.Item.Id values for order-level cost
/// lines (unas.hu/tudastar/api/megrendelesek-adatszerkezet, "Items.Item.Id"
/// - "handel-cost" kezelési költség, "shipping-cost" szállítási költség).
/// "handling-cost" isn't in UNAS's own documented list but is matched
/// defensively too, in case a different UNAS API version/webshop
/// configuration ever emits it. These must never be treated as real,
/// stock-tracked products, under any circumstance, even if a webshop
/// configuration somehow attaches a real-looking Sku to one (see
/// isTechnicalCostItem below for why Sku/Name are checked too, not just Id).
const TECHNICAL_COST_ITEM_IDENTIFIERS = new Set([
  "shipping-cost",
  "handel-cost",
  "handling-cost",
]);

/// Recognizes a UNAS order item as a technical cost/discount line (never a
/// real, stock-tracked product) by Id, Sku, or Name - not just Id, even
/// though UNAS's own docs say these should only ever appear via a special
/// Id and no Sku. Checking Sku/Name too is deliberate defense-in-depth: if
/// a webshop configuration or a future UNAS API version ever attaches a
/// real-looking Sku (or a product-like Name) to one of these rows, it must
/// still never be resolved against ProductVariant / never enter a stock
/// movement - see buildLineInputs and the syncLines() correction below.
function isTechnicalCostItem(item: UnasApiOrder["items"][number]): boolean {
  return [item.id, item.sku, item.name]
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) =>
      TECHNICAL_COST_ITEM_IDENTIFIERS.has(candidate.trim().toLowerCase()),
    );
}

/// LineInput.isTechnicalCost exists purely for internal correction logic
/// (see syncLines' isTechnicalCost branch below) - it isn't, and must never
/// become, a SalesOrderLine column. Every call site that hands a LineInput
/// to Prisma's salesOrderLine create/nested-create MUST route through this
/// first, or the extra property would fail as an unknown Prisma argument at
/// runtime (TS's excess-property check doesn't catch this through a spread).
function toLineCreateData(
  input: LineInput,
): Omit<LineInput, "isTechnicalCost"> {
  const { isTechnicalCost: _isTechnicalCost, ...data } = input;
  return data;
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
  salesOrderLine: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  invoice: {
    findUnique(
      args: unknown,
    ): Promise<{ id: string; salesOrderId: string | null } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
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
  externalReference: {
    findUnique(
      args: unknown,
    ): Promise<{ metadata: Prisma.JsonValue; externalId: string } | null>;
    findMany(
      args: unknown,
    ): Promise<Array<{ entityId: string; metadata: Prisma.JsonValue }>>;
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

/// Pure order-total computation shared by createNewOrder and the update
/// path's re-sync, so "totals" always means exactly "sum of order.items" -
/// includes shipping-cost/discount-amount/handling-cost special lines,
/// since those are just items without a sku (see UnasApiOrderItem doc).
function orderTotals(order: UnasApiOrder): {
  totalNet: Prisma.Decimal;
  totalGross: Prisma.Decimal;
} {
  let totalNet = new Prisma.Decimal(0);
  let totalGross = new Prisma.Decimal(0);
  for (const item of order.items) {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitNet = new Prisma.Decimal(item.priceNet ?? "0");
    const lineGross = new Prisma.Decimal(item.priceGross ?? "0").times(
      quantity,
    );
    totalNet = totalNet.plus(unitNet.times(quantity));
    totalGross = totalGross.plus(lineGross);
  }
  return { totalNet, totalGross };
}

/// Builds the SalesOrderLine input rows for every current UNAS order item
/// (real product lines resolved against ProductVariant by sku, plus
/// special non-stock lines like shipping-cost/discount-amount keyed by
/// their UNAS item id) - shared by order creation and by syncLines' update
/// path so both use identical pricing/variant-resolution logic.
async function buildLineInputs(
  transaction: Pick<UnasOrderSyncTransaction, "productVariant">,
  order: UnasApiOrder,
): Promise<{
  lineInputs: LineInput[];
  stockLines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
}> {
  const lineInputs: LineInput[] = [];
  const stockLines: Array<{ variantId: string; quantity: Prisma.Decimal }> = [];

  for (const item of order.items) {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitNet = new Prisma.Decimal(item.priceNet ?? "0");
    const taxRate = new Prisma.Decimal(item.vatRate ?? "0");
    const lineGross = new Prisma.Decimal(item.priceGross ?? "0").times(
      quantity,
    );

    // Checked BEFORE the `!item.sku` branch below, and takes priority over
    // it: a technical cost item is never stock-tracked even in the (per
    // UNAS's own docs, unexpected) case where it does carry a Sku - see
    // isTechnicalCostItem's own comment for why. Falling through to the
    // ordinary ProductVariant lookup for one of these would risk either a
    // spurious UNKNOWN_SKU "Hiba" badge, or, worse, a real stock deduction
    // if the Sku ever happened to collide with an actual catalog SKU.
    if (isTechnicalCostItem(item)) {
      lineInputs.push({
        variantId: null,
        sku: item.sku ?? item.id,
        description: item.name,
        quantity,
        unit: item.unit ?? "db",
        unitNet,
        taxRate,
        lineGross,
        syncStatus: "OK",
        syncError: null,
        isTechnicalCost: true,
      });
      continue;
    }

    if (!item.sku) {
      // Non-stock line (discount-amount, discount-percent, etc.): counts
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
        isTechnicalCost: false,
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
        isTechnicalCost: false,
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
      isTechnicalCost: false,
    });
    stockLines.push({ variantId: variant.id, quantity });
  }

  return { lineInputs, stockLines };
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

          const result = await this.applyExistingOrderUpdate(
            transaction,
            reference,
            order,
            warehouse.id,
            windowEnd,
          );
          if (result === null) continue; // Order row missing locally; nothing safe to reconcile against.
          if (result.updated) updatedCount += 1;
          if (result.reversed) reversedCount += 1;
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

  /// Shared existing-order update logic for one UNAS order sighting -
  /// status-transition (incl. one-time stock reversal on cancellation),
  /// billing/line/total refresh, and the read-only invoice mirror. Used by
  /// both apply()'s per-order batch loop and refreshOrder()'s single-order
  /// path, so a manual refresh and a batch poll sighting of the same order
  /// always produce identical results (e.g. a since-cancelled order still
  /// gets reversed exactly once either way). Returns null if the
  /// ExternalReference points at a SalesOrder row that no longer exists
  /// locally (nothing safe to reconcile against); otherwise {updated,
  /// reversed} flags for the caller to fold into its own counters (apply())
  /// or ignore (refreshOrder()).
  private async applyExistingOrderUpdate(
    transaction: UnasOrderSyncTransaction,
    reference: ExternalReferenceRow,
    order: UnasApiOrder,
    warehouseId: string,
    syncedAt: Date,
  ): Promise<{ updated: boolean; reversed: boolean } | null> {
    const existing = await transaction.salesOrder.findUnique({
      where: { id: reference.entityId },
      select: {
        id: true,
        status: true,
        unasInvoiceStatus: true,
        lines: {
          select: {
            id: true,
            sku: true,
            variantId: true,
            quantity: true,
            syncStatus: true,
          },
        },
      },
    });
    if (!existing) return null; // Order row missing locally; nothing safe to reconcile against.

    let updated = false;
    let reversed = false;

    const newStatus = mapUnasOrderStatus(order.statusType);
    const invoiceStatusChanged =
      order.invoiceStatus !== existing.unasInvoiceStatus;
    const billingFields = {
      buyerName: order.buyerInvoiceName,
      buyerTaxNumber: order.buyerTaxNumber,
      buyerEuTaxNumber: order.buyerEuTaxNumber,
      buyerCustomerType: order.buyerCustomerType,
      buyerCountryCode: order.buyerCountryCode,
      buyerZip: order.buyerZip,
      buyerCity: order.buyerCity,
      buyerAddress: order.buyerAddress,
    };
    const totals = orderTotals(order);

    if (newStatus === "CANCELLED" && existing.status !== "CANCELLED") {
      await this.reverseOrder(transaction, existing, warehouseId);
      reversed = true;
      await transaction.salesOrder.update({
        where: { id: existing.id },
        data: {
          unasInvoiceStatus: order.invoiceStatus,
          ...billingFields,
        },
      });
    } else if (newStatus === "CANCELLED" && existing.status === "CANCELLED") {
      // Repeated sighting of an order that's already CANCELLED locally and
      // is still CANCELLED per UNAS (e.g. re-surfaced by the TimeModStart
      // overlap window, an admin comment bumping DateMod, or a manual
      // refresh of an already-cancelled order). Deliberately skipped
      // entirely: NOT the live-order branch below (no syncLines - a dead
      // order's line items don't need to track UNAS price/description
      // edits, and re-running it would be pure waste) and NOT reverseOrder
      // (already reversed exactly once when it first transitioned to
      // CANCELLED - see the "reverses stock exactly once" test - re-running
      // it would either double-reverse stock or, thanks to its own
      // already-reversed guard, silently no-op every single call, neither
      // of which is useful). status/totals/billingFields are intentionally
      // NOT rewritten here either, so a cancelled order's terminal state
      // can never be perturbed by a later sighting. The only thing that may
      // still legitimately change for an already-cancelled order is its
      // UNAS-side invoice status (UNAS/Számlázz.hu can still bill or storno
      // a cancelled order after the fact) - that alone is refreshed,
      // conditionally, to avoid a no-op write on every stable resighting.
      // The read-only invoice mirror itself (syncInvoiceMirror below)
      // always runs regardless of this branch and reads straight from the
      // fresh `order` payload, so it stays accurate even without touching
      // SalesOrder here.
      if (invoiceStatusChanged) {
        await transaction.salesOrder.update({
          where: { id: existing.id },
          data: { unasInvoiceStatus: order.invoiceStatus },
        });
        updated = true;
      }
    } else {
      // Every sighting of an already-known, still-live order refreshes its
      // line items/prices/discounts/shipping/currency/totals from the fresh
      // UNAS payload - not just on a status or invoice-status change.
      // Previously only status + billing address were kept current, so a
      // modified-but-not-yet-cancelled order's actual items/amounts could
      // silently drift from what UNAS reports. Deliberately does NOT touch
      // stock here: matched lines only have their pricing/description
      // fields refreshed (no quantity-driven StockItem/StockMovement
      // adjustment), and removed items are left in place rather than
      // deleted - reconciling stock deltas for an edited order, and whether
      // a UNAS-removed line should ever be deleted locally, is an open
      // business decision, not something to guess at here (see
      // docs/ACROPORA-OS-MASTER-MILESTONE-PLAN.md, "11. Nyitott üzleti
      // döntések", #13). syncLines also corrects any previously
      // mis-stock-managed technical cost line (see isTechnicalCost) back to
      // non-stock, regardless of which entry point (apply() or
      // refreshOrder()) triggered this branch.
      await this.syncLines(transaction, existing, order);
      await transaction.salesOrder.update({
        where: { id: existing.id },
        data: {
          status: newStatus,
          unasInvoiceStatus: order.invoiceStatus,
          currency: order.currency ?? "HUF",
          totalNet: totals.totalNet,
          totalTax: totals.totalGross.minus(totals.totalNet),
          totalGross: totals.totalGross,
          ...billingFields,
        },
      });
      if (newStatus !== existing.status || invoiceStatusChanged) updated = true;
    }

    await this.syncInvoiceMirror(transaction, existing.id, order);

    await transaction.externalReference.update({
      where: { id: reference.id },
      data: {
        metadata: json({
          unasStatus: order.status,
          unasStatusType: order.statusType,
          paymentName: order.paymentName,
          paymentType: order.paymentType,
          paymentStatus: order.paymentStatus,
          shippingName: order.shippingName,
          couponCode: order.couponCode,
        }),
        lastSyncedAt: syncedAt,
      },
    });

    return { updated, reversed };
  }

  /// Looks up the UNAS order Key for a local SalesOrder id, for
  /// refreshOrder()'s targeted single-order getOrder fetch. Null if this
  /// order was never UNAS-synced (e.g. a purely local/POS order), in which
  /// case there's nothing to refresh it against.
  async getUnasKey(orderId: string): Promise<string | null> {
    const reference = await this.syncDatabase.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: "UNAS",
          entityType: "SalesOrder",
          entityId: orderId,
        },
      },
    });
    return reference?.externalId ?? null;
  }

  /// Manual single-order refresh: re-applies one already-fetched UNAS
  /// order (fetched by the caller via the UNAS getOrder `Key` filter - see
  /// UnasApiClient.getOrderByKey - never a time-window/batch fetch) through
  /// the exact same applyExistingOrderUpdate logic apply() uses, in its own
  /// short transaction. Deliberately never touches unasOrderSyncRun or
  /// integrationCursor (both are only ever written inside apply()'s batch
  /// transaction, above) - structurally guarantees the general incremental
  /// sync cursor is unaffected by a manual refresh. Deliberately never calls
  /// createNewOrder either (only reachable via apply()'s !reference branch)
  /// - guarantees a refresh of an existing order can never create a second,
  /// duplicate SALE stock movement, since only createNewOrder ever creates
  /// one. Throws if the order's UNAS Key doesn't match the order this was
  /// invoked for (defensive: would only happen if the local ExternalReference
  /// and the fetched order's Key have somehow diverged), or if the order
  /// isn't found locally at all.
  async refreshOrder(
    orderId: string,
    order: UnasApiOrder,
  ): Promise<{ updated: boolean; reversed: boolean }> {
    return this.syncDatabase.$transaction(
      async (transaction) => {
        const reference = await transaction.externalReference.findUnique({
          where: {
            system_entityType_externalId: {
              system: "UNAS",
              entityType: "SalesOrder",
              externalId: order.key,
            },
          },
        });
        if (!reference || reference.entityId !== orderId) {
          throw new ConflictException("UNAS_ORDER_KEY_MISMATCH");
        }

        const warehouse = await ensureMainWarehouse(transaction);
        const result = await this.applyExistingOrderUpdate(
          transaction,
          reference,
          order,
          warehouse.id,
          new Date(),
        );
        if (result === null)
          throw new NotFoundException("A rendelés nem található.");
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
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
    const { lineInputs, stockLines } = await buildLineInputs(
      transaction,
      order,
    );
    const totals = orderTotals(order);

    const orderRow = await transaction.salesOrder.create({
      data: {
        orderNumber: `UNAS-${order.key}`,
        channel: "UNAS",
        status: mapUnasOrderStatus(order.statusType),
        currency: order.currency ?? "HUF",
        warehouseId,
        buyerName: order.buyerInvoiceName,
        buyerEmail: order.customerEmail,
        buyerTaxNumber: order.buyerTaxNumber,
        buyerEuTaxNumber: order.buyerEuTaxNumber,
        buyerCustomerType: order.buyerCustomerType,
        buyerCountryCode: order.buyerCountryCode,
        buyerZip: order.buyerZip,
        buyerCity: order.buyerCity,
        buyerAddress: order.buyerAddress,
        unasInvoiceStatus: order.invoiceStatus,
        totalNet: totals.totalNet,
        totalTax: totals.totalGross.minus(totals.totalNet),
        totalGross: totals.totalGross,
        orderedAt: order.orderedAt ? new Date(order.orderedAt) : null,
        lines: { create: lineInputs.map(toLineCreateData) },
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
          paymentName: order.paymentName,
          paymentType: order.paymentType,
          paymentStatus: order.paymentStatus,
          shippingName: order.shippingName,
        }),
        lastSyncedAt: new Date(),
      },
    });

    // Edge case: an order can already be BILLED by the time we first see
    // it (e.g. a late first sync of an old order) - mirror it immediately
    // rather than waiting for the next poll.
    await this.syncInvoiceMirror(transaction, orderRow.id, order);
  }

  /// Refreshes existing SalesOrderLine rows' pricing/description (matched
  /// to the fresh UNAS item by sku, which is also how special non-stock
  /// lines like shipping-cost are keyed - see buildLineInputs) and adds
  /// rows for items that weren't seen before. Deliberately does NOT delete
  /// lines whose item disappeared from the UNAS order, and does NOT touch
  /// StockItem/StockMovement for quantity changes on existing lines (see
  /// the call site's comment in apply() for why this is a documented,
  /// bounded limitation rather than full stock-delta reconciliation).
  private async syncLines(
    transaction: UnasOrderSyncTransaction,
    existing: OrderRow,
    order: UnasApiOrder,
  ): Promise<void> {
    const { lineInputs } = await buildLineInputs(transaction, order);
    const existingBySku = new Map(
      existing.lines.map((line) => [line.sku, line]),
    );
    for (const input of lineInputs) {
      const match = existingBySku.get(input.sku);
      if (match) {
        await transaction.salesOrderLine.update({
          where: { id: match.id },
          data: {
            description: input.description,
            quantity: input.quantity,
            unit: input.unit,
            unitNet: input.unitNet,
            taxRate: input.taxRate,
            lineGross: input.lineGross,
            // A technical cost line (shipping-cost/handel-cost/handling-cost,
            // see isTechnicalCostItem) is always forced back to non-stock
            // here, regardless of its current variantId/syncStatus - this is
            // the "correction" path for a line that was previously
            // mis-matched against a real ProductVariant (e.g. before this
            // check existed, or because a webshop config attached a
            // real-looking Sku to it). Checked before, and takes priority
            // over, the ordinary FAILED->OK forward-resolution rule below,
            // since a technical-cost line must never end up stock-linked no
            // matter which direction the correction runs.
            ...(input.isTechnicalCost
              ? { variantId: null, syncStatus: "OK", syncError: null }
              : // Only re-resolve variant linkage forward (FAILED -> OK, e.g. a
                // product that was missing at order-creation time got added to
                // the catalog since); never regress an already-OK, stock-linked
                // line to FAILED just because of a transient lookup miss within
                // this same pass, since buildLineInputs re-does the variantId
                // lookup identically to order creation and would otherwise be
                // safe to trust either way - kept one-directional purely to
                // avoid ever silently unlinking stock history from a line.
                match.syncStatus === "FAILED" && input.syncStatus === "OK"
                ? {
                    variantId: input.variantId,
                    syncStatus: "OK",
                    syncError: null,
                  }
                : {}),
          },
        });
      } else {
        await transaction.salesOrderLine.create({
          data: { orderId: existing.id, ...toLineCreateData(input) },
        });
      }
    }
  }

  /// Read-only UNAS -> Acropora OS invoice mirror. The actual outgoing
  /// webshop invoice is issued by UNAS's own built-in Számlázz.hu module,
  /// never by Acropora OS (see docs/ACROPORA-OS-MASTER-MILESTONE-PLAN.md
  /// "Kimenő számlázás architektúrája") - this only records what UNAS
  /// itself reports once Invoice.Status reaches BILLED (2). Never calls
  /// Számlázz.hu, never writes back to UNAS. Idempotent via the
  /// @@unique([source, invoiceNumber]) constraint on Invoice: repeated
  /// sightings of the same order/invoice update the same row instead of
  /// duplicating it, and two different local orders can never collapse
  /// onto the same mirrored invoice (see the conflict guard below).
  private async syncInvoiceMirror(
    transaction: UnasOrderSyncTransaction,
    salesOrderId: string,
    order: UnasApiOrder,
  ): Promise<void> {
    if (order.invoiceStatus !== "BILLED") return;
    // UNAS reports "billed" but didn't (yet) give a number, or gave no
    // invoice-address name to bill under (Invoice.partnerName is
    // required) - nothing safe to persist. Retried on the next sighting
    // rather than guessed at now.
    if (!order.invoiceNumber || !order.buyerInvoiceName) return;

    const existing = await transaction.invoice.findUnique({
      where: {
        source_invoiceNumber: {
          source: "UNAS",
          invoiceNumber: order.invoiceNumber,
        },
      },
    });
    if (
      existing &&
      existing.salesOrderId &&
      existing.salesOrderId !== salesOrderId
    ) {
      // Should be impossible - Számlázz.hu invoice numbers are unique per
      // billing account - but never silently reassign an already-mirrored
      // invoice from one local order to another; leave it as an
      // unresolved conflict rather than merge two orders' data.
      return;
    }

    if (existing) {
      await transaction.invoice.update({
        where: { id: existing.id },
        data: {
          salesOrderId,
          partnerName: order.buyerInvoiceName,
          partnerTaxNumber: order.buyerTaxNumber,
          currency: order.currency ?? "HUF",
          externalUrl: order.invoiceUrl,
          syncStatus: "RECEIVED",
        },
      });
      return;
    }

    await transaction.invoice.create({
      data: {
        direction: "OUTBOUND",
        documentType: "INVOICE",
        source: "UNAS",
        invoiceNumber: order.invoiceNumber,
        partnerName: order.buyerInvoiceName,
        partnerTaxNumber: order.buyerTaxNumber,
        salesOrderId,
        currency: order.currency ?? "HUF",
        externalUrl: order.invoiceUrl,
        syncStatus: "RECEIVED",
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
    const metadataByOrderId = await this.loadMetadataFor(
      items.map((item) => item.id),
    );
    return {
      items: items.map((item) =>
        toUnasOrderListItem(item, metadataByOrderId.get(item.id) ?? null),
      ),
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
    if (!order) return null;
    const reference = await this.syncDatabase.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: "UNAS",
          entityType: "SalesOrder",
          entityId: id,
        },
      },
    });
    return toUnasOrderDetail(
      order,
      reference ? (reference.metadata as UnasOrderMetadata | null) : null,
    );
  }

  /// Orders have no direct Prisma relation to ExternalReference (it's a
  /// loose system/entityType/entityId join, reused across every integration
  /// - see the model comment), so list rows are enriched via a single batch
  /// query rather than N+1 lookups.
  private async loadMetadataFor(
    orderIds: string[],
  ): Promise<Map<string, UnasOrderMetadata | null>> {
    if (orderIds.length === 0) return new Map();
    const references = await this.syncDatabase.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: "SalesOrder",
        entityId: { in: orderIds },
      },
    });
    return new Map(
      references.map((reference) => [
        reference.entityId,
        reference.metadata as UnasOrderMetadata | null,
      ]),
    );
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
