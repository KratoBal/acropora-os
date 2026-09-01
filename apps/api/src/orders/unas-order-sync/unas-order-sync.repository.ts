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

import {
  postInventoryMovement,
  type InventoryMovementDatabase,
  type InventoryMovementLineInput,
  type InventoryMovementSourceProcess,
} from "../../common/inventory-movement-writer.js";
import { isUnasMasteredVariant } from "../../products/catalog-authority.js";
import { isPrismaErrorCode } from "../../common/prisma-error.util.js";
import { sumOrderBookedOut } from "../../common/stock-ledger.util.js";
import { retryOnSerializationConflict } from "../../common/transaction-retry.util.js";
import { parseUnasPackageComponents } from "../../common/unas-package-product.util.js";
import { unasVariantKey } from "../../common/unas-variant.util.js";
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
const listInclude = {
  _count: {
    select: { lines: { where: { unasRemovedAt: null } } },
  },
} as const;

/// ONE row shape for both seams that read an ExternalReference.
///
/// It used to be declared twice with incompatible projections: the
/// transaction seam promised `{id, entityId, externalId, externalKey}` and
/// the database seam `{metadata, externalId, externalKey}`. Measured on
/// 2026-09-01: NONE of the four `findUnique` call sites passes a `select`,
/// so Prisma returns the whole row at every one of them. The two narrow
/// types were not describing the query, only which fields that particular
/// consumer happened to read - and a hand-narrowed type that nothing
/// enforces drifts. It had already drifted: no single object can honestly
/// answer two projections, so the test double returned a union behind an
/// `any` parameter, and that `any` is what hid the conflict.
///
/// If a `select` is ever added to one of those calls, this type must be
/// narrowed in the same change - a deliberate step, unlike today's silent
/// mismatch.
export interface ExternalReferenceRow {
  id: string;
  entityId: string;
  externalId: string;
  externalKey: string | null;
  /// `JsonValue`, not `Record<string, unknown>`: the contract stores it as
  /// JSON, and a wider type lets values through that the database rejects.
  metadata: Prisma.JsonValue;
}

// Exported (along with LineInput, resolveEffectiveVariantId,
// aggregateTargetOut below) so the read-only historical UNAS order audit
// (unas-order-stock-audit.service.ts) can recompute the EXACT same
// "effective variant"/"target booked-out quantity" a live import/resync
// would - never a second, independently-maintained approximation of this
// logic.
export interface OrderLineRow {
  id: string;
  sku: string;
  variantId: string | null;
  quantity: Prisma.Decimal;
  syncStatus: string;
  unasRemovedAt: Date | null;
}

interface OrderRow {
  id: string;
  status: string;
  unasInvoiceStatus: string | null;
  /// Nem NULL = a rendelést UNAS-ból FIZIKAILAG törölték - lásd
  /// SalesOrder.unasDeletedAt doc-comment a schema.prisma-ban. Csak azokban
  /// a select-ekben töltött ki ténylegesen, ahol szükséges (l. az egyes
  /// hívási helyeket) - más helyeken undefined marad futásidőben, annak
  /// ellenére, hogy a típus mindig jelenlévőnek jelöli (ugyanaz a
  /// pragmatikus, `args: unknown`-alapú minta, mint e fájl többi
  /// hand-written Prisma interfésze).
  unasDeletedAt: Date | null;
  lines: OrderLineRow[];
}

export interface LineInput {
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
  /** Physical variants affected by selling one unit of this order line.
   * Normal products contain themselves with qty=1; UNAS package products
   * contain their component variants and never the package variant. */
  stockTargets: Array<{
    variantId: string;
    sku: string;
    unit: string;
    quantityPerItem: Prisma.Decimal;
  }>;
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
): Omit<LineInput, "isTechnicalCost" | "stockTargets"> {
  const {
    isTechnicalCost: _isTechnicalCost,
    stockTargets: _stockTargets,
    ...data
  } = input;
  return data;
}

/// Determines the FINAL, stock-relevant variantId for one current-pass UNAS
/// order item, given the existing (pre-this-pass) SalesOrderLine it matches
/// by sku, if any. This is the exact same one-directional resolution rule
/// syncLines() already applied to its own Prisma update payload (see that
/// method's own long comment) - pulled out into a pure function so the new
/// stock-delta engine (aggregateTargetOut below) computes quantities against
/// PRECISELY the same effective linkage syncLines() writes to the DB, never
/// a subtly different one:
///  - a technical cost line (isTechnicalCost) is never stock-linked, however
///    it was previously classified;
///  - an already-OK-linked existing line KEEPS its persisted variantId
///    (which is `null` for a non-stock line like a discount/shipping row,
///    or a real variant id for a genuine product line) even if this pass's
///    fresh sku lookup would now resolve differently or fail - stock
///    history/linkage is never silently reassigned or unlinked;
///  - a FAILED existing line whose sku now resolves (input.syncStatus
///    "OK") is forward-resolved to the newly found variantId - covers "a
///    product that was missing at order-creation time got added to the
///    catalog since";
///  - anything else (still-unresolved existing line, or a brand-new line
///    this pass whose own lookup failed) has no stock-relevant variant.
export function resolveEffectiveVariantId(
  match: OrderLineRow | undefined,
  input: LineInput,
): string | null {
  if (input.isTechnicalCost) return null;
  if (!match) return input.variantId;
  if (match.syncStatus === "OK") return match.variantId;
  if (match.syncStatus === "FAILED" && input.syncStatus === "OK") {
    return input.variantId;
  }
  return null;
}

interface MatchedLineInput {
  input: LineInput;
  match: OrderLineRow | undefined;
}

/// Pairs each fresh UNAS line with at most one still-active local line.
/// A queue per SKU is required here: Map<SKU, line> silently collapsed
/// duplicate order rows and caused one local line to be updated repeatedly.
/// Removed audit rows are deliberately excluded, so a later reappearance
/// creates a new active row instead of erasing the historical removal.
function matchLineInputs(
  lineInputs: LineInput[],
  existingLines: OrderLineRow[],
): MatchedLineInput[] {
  const activeBySku = new Map<string, OrderLineRow[]>();
  for (const line of existingLines) {
    if (line.unasRemovedAt) continue;
    const queue = activeBySku.get(line.sku) ?? [];
    queue.push(line);
    activeBySku.set(line.sku, queue);
  }

  return lineInputs.map((input) => ({
    input,
    match: activeBySku.get(input.sku)?.shift(),
  }));
}

/// Aggregates the CURRENT sighting's desired cumulative "removed from
/// stock" quantity per variantId - the target half of `delta = target -
/// alreadyBooked` (see applyOrderStockDelta). Two UNAS items resolving to
/// the same variantId (e.g. the same SKU listed twice) correctly sum
/// together rather than overwrite. `existingBySku` is `null` for a
/// brand-new order (createNewOrder - nothing to preserve/forward-resolve
/// against yet); non-null for an existing order's resync (syncLines'
/// `existingBySku`, built from the order's pre-this-pass SalesOrderLine
/// rows).
export function aggregateTargetOut(
  lineInputs: LineInput[],
  existingLines: OrderLineRow[] | null,
): Map<string, Prisma.Decimal> {
  const target = new Map<string, Prisma.Decimal>();
  for (const { input, match } of matchLineInputs(
    lineInputs,
    existingLines ?? [],
  )) {
    const variantId = resolveEffectiveVariantId(match, input);
    if (!variantId) continue;
    // An empty list means that no physical stock target was resolved safely
    // (technical/non-stock/unknown line, or an invalid package). Never fall
    // back to booking the package/master variant itself.
    if (input.stockTargets.length === 0) continue;
    for (const stockTarget of input.stockTargets) {
      const running =
        target.get(stockTarget.variantId) ?? new Prisma.Decimal(0);
      target.set(
        stockTarget.variantId,
        running.plus(input.quantity.times(stockTarget.quantityPerItem)),
      );
    }
  }
  return target;
}

/// Postgres transaction-scoped advisory lock serializing every stock-delta
/// computation/posting for one UNAS order (keyed by its own stable UNAS
/// `key`, never the local cuid, since createNewOrder computes this before a
/// local id even exists). Without this, two concurrent sightings of the
/// SAME order (e.g. a scheduled batch tick and a manual "Rendelés
/// frissítése" refresh overlapping) could both read the same "already
/// booked" ledger snapshot before either commits and independently compute
/// - and both post - the same delta, double-booking it. Mirrors
/// lockVariantWarehouse's same rationale in inventory-movement-writer.ts,
/// just keyed by order instead of (variantId, warehouseId).
async function lockUnasOrder(
  database: Pick<UnasOrderSyncTransaction, "$executeRaw">,
  unasKey: string,
): Promise<void> {
  const key = `UNAS_ORDER:${unasKey}`;
  await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

interface OrderStockMovementWithLines {
  type: string;
  lines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
}

/// Exported so a test double can NAME the contract it stands in for. This is
/// the seam: the repository hands the transaction object to the movement
/// writer's helpers, so what a double must satisfy is THIS type, not the
/// outer database interface. Taken as `any`, a double compiles while missing
/// a method those helpers call, and fails only at run time.
export interface UnasOrderSyncTransaction
  extends WarehouseLookupDatabase, InventoryMovementDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  productVariant: {
    findFirst(args: unknown): Promise<{
      id: string;
      sku: string;
      unit: string;
      product: {
        catalogAuthority: "UNAS" | "ACROPORA" | null;
        unasSnapshot: {
          isPackageProduct: boolean;
          packageComponents: Prisma.JsonValue;
        } | null;
      };
    } | null>;
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        product: {
          catalogAuthority: "UNAS" | "ACROPORA" | null;
          unasSnapshot: { isPackageProduct: boolean } | null;
        };
      }>
    >;
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
  // Widens InventoryMovementDatabase's own {findFirst, create} with the
  // findMany the new delta engine needs to derive "already booked" quantity
  // straight from the ledger (see computeBookedOutAndGeneration) - no direct
  // StockItem/StockMovement writes happen in this file anymore, everything
  // routes through postInventoryMovement.
  stockMovement: InventoryMovementDatabase["stockMovement"] & {
    findMany(args: unknown): Promise<OrderStockMovementWithLines[]>;
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
          isPackageProduct: boolean;
        } | null;
        variants: Array<{
          id: string;
          sku: string;
          unasReportedStock?: Prisma.Decimal | null;
          unasReportedStockSyncedAt?: Date | null;
        }>;
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
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
}> {
  const lineInputs: LineInput[] = [];

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
        stockTargets: [],
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
        stockTargets: [],
      });
      continue;
    }

    const orderVariantKey = unasVariantKey(
      (item.variants ?? []).map((variant) => ({
        name: variant.name,
        value: variant.value,
      })),
    );
    const variant = await transaction.productVariant.findFirst({
      where: orderVariantKey
        ? {
            isActive: true,
            unasBaseSku: item.sku,
            unasVariantKey: orderVariantKey,
          }
        : {
            isActive: true,
            sku: item.sku,
          },
      select: {
        id: true,
        sku: true,
        unit: true,
        product: {
          select: {
            catalogAuthority: true,
            unasSnapshot: {
              select: { isPackageProduct: true, packageComponents: true },
            },
          },
        },
      },
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
        syncError: orderVariantKey
          ? `UNKNOWN_UNAS_VARIANT:${item.sku}:${orderVariantKey}`
          : `UNKNOWN_SKU:${item.sku}`,
        isTechnicalCost: false,
        stockTargets: [],
      });
      continue;
    }

    const packageComponents = variant.product.unasSnapshot?.isPackageProduct
      ? parseUnasPackageComponents(
          variant.product.unasSnapshot.packageComponents,
        )
      : [];
    let stockTargets: LineInput["stockTargets"];
    if (variant.product.unasSnapshot?.isPackageProduct) {
      const componentVariants =
        packageComponents.length > 0
          ? await transaction.productVariant.findMany({
              where: {
                sku: {
                  in: packageComponents.map((component) => component.sku),
                },
                isActive: true,
              },
              select: {
                id: true,
                sku: true,
                unit: true,
                product: {
                  select: {
                    catalogAuthority: true,
                    unasSnapshot: { select: { isPackageProduct: true } },
                  },
                },
              },
            })
          : [];
      const componentBySku = new Map(
        componentVariants.map((component) => [component.sku, component]),
      );
      stockTargets = packageComponents.flatMap((component) => {
        const resolved = componentBySku.get(component.sku);
        return resolved &&
          isUnasMasteredVariant(resolved) &&
          !resolved.product.unasSnapshot?.isPackageProduct
          ? [
              {
                variantId: resolved.id,
                sku: resolved.sku,
                unit: resolved.unit,
                quantityPerItem: component.qty,
              },
            ]
          : [];
      });
      if (
        packageComponents.length === 0 ||
        stockTargets.length !== packageComponents.length
      ) {
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
          syncError: `PACKAGE_COMPONENT_UNRESOLVED:${item.sku}`,
          isTechnicalCost: false,
          stockTargets: [],
        });
        continue;
      }
    } else {
      stockTargets = [
        {
          variantId: variant.id,
          sku: variant.sku,
          unit: variant.unit,
          quantityPerItem: new Prisma.Decimal(1),
        },
      ];
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
      stockTargets,
    });
  }

  return { lineInputs };
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
      // Structural (non-instanceof) check - see prisma-error.util.ts's own
      // doc comment for why `instanceof Prisma.PrismaClientKnownRequestError`
      // can't be relied on to narrow `error` in this environment. Opportunistically
      // fixed here (this file was already being substantially rewritten for
      // the delta engine) rather than left as the one remaining occurrence.
      if (isPrismaErrorCode(error, "P2002")) {
        throw new ConflictException("UNAS_ORDER_SYNC_ALREADY_RUNNING");
      }
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
  /// SalesOrder, and every order (new or existing) has its stock delta
  /// posted via applyOrderStockDelta - the difference between what's
  /// currently desired (the order's live line items, or nothing at all once
  /// cancelled) and what this order has already, net, booked out of stock
  /// per the StockMovement/StockMovementLine ledger; anything else just
  /// refreshes the mirrored status. Guards against re-processing the same
  /// UNAS Key twice via ExternalReference, and against double-booking a
  /// delta via the order-level advisory lock plus the ledger-derived
  /// "already booked" comparison (see applyOrderStockDelta) - both matter
  /// because TimeModStart re-surfaces an order on every poll until a newer
  /// windowEnd passes it by.
  async apply(
    runId: string,
    orders: readonly UnasApiOrder[],
    windowStart: Date | null,
    windowEnd: Date,
  ): Promise<UnasOrderSyncSummary> {
    // The whole transaction retries as a unit (never a single statement
    // inside it) on a genuine Postgres SERIALIZABLE conflict (Prisma
    // P2034) - see transaction-retry.util.ts's own doc comment for why
    // this is expected, standard behavior for Serializable isolation, not
    // a sign that the order-level advisory lock (lockUnasOrder, inside
    // applyOrderStockDelta below) or any idempotency check is broken. Any
    // other error - including a real business error thrown from inside
    // the callback - is rethrown immediately, never retried.
    return retryOnSerializationConflict(() =>
      this.syncDatabase.$transaction(
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
            const reference = await this.findExternalReferenceForOrder(
              transaction,
              order,
            );

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
      ),
    );
  }

  /// Resolves the ExternalReference for one UNAS order sighting - the
  /// single place both apply()'s per-order discovery loop and
  /// refreshOrder() look up (or fail to find) the locally-known order for
  /// a given UNAS `order.key`/`order.id` pair.
  ///
  /// See UnasApiOrder.id's own doc-comment: UNAS's official docs state a
  /// deleted order's `Key` CAN be reissued later, while `Id` never is - so
  /// from this checkpoint onward ExternalReference.externalId stores the
  /// stable `Id`, and the PRIMARY lookup here is by Id, never Key. A
  /// FALLBACK lookup by the legacy externalId=Key convention covers every
  /// ExternalReference row created before this change (never bulk-
  /// backfilled - see docs/INVENTORY-CONSISTENCY.md "UNAS Key/Id") for an
  /// order that's still the SAME, live/still-tracked order. Matching via
  /// the fallback is safe specifically because a genuinely REUSED Key can
  /// only ever collide with a row whose SalesOrder is already
  /// unasDeletedAt (UNAS only reissues a Key after deleting the order that
  /// held it) - and the fallback deliberately refuses to match such a row,
  /// so a reused Key can never resurrect or overwrite the old, preserved,
  /// deleted order (see reconcileDeletedOrder and business rule 5's
  /// "ne frissítsd felül a korábbi, törölt rendelést"). On a successful
  /// fallback match for a NOT-YET-deleted order, the row is
  /// opportunistically, lazily backfilled to the Id-based convention
  /// (externalId := order.id) so every later sighting of this SAME order
  /// takes the fast, primary path - no separate batch migration job
  /// needed. If `order.id` is ever null (defensive-only; not expected per
  /// UNAS's own docs), only the legacy fallback runs.
  private async findExternalReferenceForOrder(
    transaction: UnasOrderSyncTransaction,
    order: UnasApiOrder,
  ): Promise<ExternalReferenceRow | null> {
    if (order.id) {
      const byId = await transaction.externalReference.findUnique({
        where: {
          system_entityType_externalId: {
            system: "UNAS",
            entityType: "SalesOrder",
            externalId: order.id,
          },
        },
      });
      if (byId) return byId;
    }

    const byLegacyKey = await transaction.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system: "UNAS",
          entityType: "SalesOrder",
          externalId: order.key,
        },
      },
    });
    if (!byLegacyKey) return null;

    const linkedOrder = await transaction.salesOrder.findUnique({
      where: { id: byLegacyKey.entityId },
      select: { id: true, unasDeletedAt: true },
    });
    if (!linkedOrder || linkedOrder.unasDeletedAt) {
      // Either the row is already an orphaned reference (shouldn't happen,
      // but never trusted blindly), or it points at an order already
      // confirmed deleted-in-UNAS - in both cases this Key sighting must be
      // treated as a brand-new, distinct order (apply()'s !reference
      // branch), never as this old row.
      return null;
    }

    if (order.id) {
      // Lazy backfill: from now on this SAME order is found via the fast,
      // primary Id-based lookup above. Never touches unasDeletedAt/status/
      // any other field - purely a key-convention migration for this one
      // row.
      await transaction.externalReference.update({
        where: { id: byLegacyKey.id },
        data: { externalId: order.id },
      });
      return { ...byLegacyKey, externalId: order.id };
    }
    return byLegacyKey;
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
        unasDeletedAt: true,
        lines: {
          select: {
            id: true,
            sku: true,
            variantId: true,
            quantity: true,
            syncStatus: true,
            unasRemovedAt: true,
          },
        },
      },
    });
    if (!existing) return null; // Order row missing locally; nothing safe to reconcile against.
    const restoresFalseDeletion = existing.unasDeletedAt !== null;
    if (restoresFalseDeletion) {
      // A fresh, targeted/list UNAS response can safely repair a false
      // deletion marker only when it resolves through the SAME stable UNAS
      // Id. Key alone is deliberately insufficient because UNAS may reuse a
      // deleted order's Key for a different order. findExternalReferenceForOrder
      // already rejects a deleted legacy-Key match; this explicit identity
      // check is the final guard before stock can be deducted again.
      if (!order.id || reference.externalId !== order.id) {
        throw new ConflictException("UNAS_ORDER_RECOVERY_ID_MISMATCH");
      }
      // Clear the marker inside the same Serializable transaction as the
      // corrective stock delta and order refresh below. Any later failure
      // rolls the whole recovery back, so status/ledger/marker cannot split.
      await transaction.salesOrder.update({
        where: { id: existing.id },
        data: { unasDeletedAt: null },
      });
    }

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
      // Sztornó: a cél mindig 0 minden variánsra, amit ez a rendelés valaha
      // ténylegesen levont a készletből - a deltás motor (targetOut=üres
      // Map) így magától csak azt adja vissza, ami MÉG nincs visszaadva
      // (l. applyOrderStockDelta doksi: "3 -> 1 -> sztornó" eset: a 3 -> 1
      // lépésnél már visszajött 2, sztornókor csak a fennmaradó 1 jön
      // vissza - nincs kettős visszavétel).
      const deltaResult = await this.applyOrderStockDelta(transaction, {
        orderId: existing.id,
        unasKey: order.key,
        warehouseId,
        targetOut: new Map(),
        variantMeta: this.buildVariantMeta(existing.lines, []),
        sourceProcess: "UNAS_ORDER_CANCEL",
      });
      reversed = deltaResult.changed;
      await transaction.salesOrder.update({
        where: { id: existing.id },
        data: {
          status: newStatus,
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
      // edits, and re-running it would be pure waste) and NOT
      // applyOrderStockDelta (already brought bookedOut to 0 for every
      // variant when it first transitioned to CANCELLED - see the
      // "reverses stock exactly once" test; re-running it here would
      // recompute delta=0 for everything anyway thanks to the ledger-based
      // bookedOut check, so skipping it entirely is purely an optimization,
      // not a correctness requirement). status/totals/billingFields are intentionally
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
      // döntések", #13 - immár MEGVÁLASZOLVA ebben a checkpointban: a
      // korábbi "nem tudjuk, hogyan reagáljunk a mennyiségváltozásra"
      // döntés helyett a deltás motor pontosan a különbséget könyveli (l.
      // applyOrderStockDelta), amint egy tétel mennyisége/hozzárendelése
      // változik - lásd docs/INVENTORY-CONSISTENCY.md "UNAS
      // webshoprendelések". syncLines a soronkénti mezőket (ár/leírás/
      // mennyiség a SalesOrderLine-on) frissíti és a technikai
      // költségsorokat korrigálja vissza nem-készletesre; az effektív
      // variantId-t (resolveEffectiveVariantId) UGYANÚGY számolja, mint a
      // lentebbi targetOut aggregálás, hogy a két lépés sose térjen el
      // egymástól.
      const { lineInputs } = await buildLineInputs(transaction, order);
      await this.syncLines(transaction, existing, lineInputs, syncedAt);
      const targetOut = aggregateTargetOut(lineInputs, existing.lines);
      const deltaResult = await this.applyOrderStockDelta(transaction, {
        orderId: existing.id,
        unasKey: order.key,
        warehouseId,
        targetOut,
        variantMeta: this.buildVariantMeta(existing.lines, lineInputs),
        sourceProcess: "UNAS_ORDER_UPDATE",
      });
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
      // deltaResult.changed folded in: a puszta mennyiségváltozás (pl. 2 ->
      // 3 ugyanazon az élő rendelésen, státusz/számlaállapot változása
      // nélkül) korábban NEM számított "updated"-nek az összegzésben - ez
      // pontatlan volt, most már valódi készlethatás is "updated"-nek
      // számít.
      if (
        restoresFalseDeletion ||
        newStatus !== existing.status ||
        invoiceStatusChanged ||
        deltaResult.changed
      ) {
        updated = true;
      }
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

    return { updated: updated || restoresFalseDeletion, reversed };
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
    // getOrder's targeted lookup accepts Key, not the stable Id. Never fall
    // back to externalId: after the Id/Key split that would turn a missing
    // Key into a false NOT_FOUND and could reverse live-order stock.
    return reference?.externalKey ?? null;
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
  /// - guarantees a refresh cannot create a second SalesOrder row. A stock
  /// delta can still legitimately create a later SALE movement (quantity
  /// increase, newly resolved line, or stable-Id-verified false-deletion
  /// recovery), but always only for the ledger-derived net difference.
  /// Throws if the order's UNAS Key doesn't match the order this was
  /// invoked for (defensive: would only happen if the local ExternalReference
  /// and the fetched order's Key have somehow diverged), or if the order
  /// isn't found locally at all.
  async refreshOrder(
    orderId: string,
    order: UnasApiOrder,
  ): Promise<{ updated: boolean; reversed: boolean }> {
    // Same whole-transaction retry as apply() above, for the same reason -
    // two concurrent refreshOrder() calls for the SAME order (or one
    // overlapping apply()'s own batch window) are exactly the scenario
    // lockUnasOrder already serializes at the stock-delta level, but a
    // genuine Postgres Serializable conflict (Prisma P2034) can still abort
    // one of two such concurrent transactions - see
    // transaction-retry.util.ts's doc comment.
    return retryOnSerializationConflict(() =>
      this.syncDatabase.$transaction(
        async (transaction) => {
          const reference = await this.findExternalReferenceForOrder(
            transaction,
            order,
          );
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
      ),
    );
  }

  /// Reconciles a UNAS order confirmed - via a TARGETED, single-order UNAS
  /// lookup that returned a genuine NOT_FOUND (never a mere absence from
  /// an incremental list/window response - see docs/INVENTORY-CONSISTENCY.md
  /// "UNAS-ból fizikailag törölt rendelések" and business rule 4's "A
  /// hiány önmagában nem törlésbizonyíték") - to have been PHYSICALLY
  /// DELETED from UNAS. Used by both the manual single-order refresh path
  /// (unas-order-sync.service.ts's refreshOrder(), on a confirmed
  /// getOrderByKey NOT_FOUND) and the automatic deletion-reconciliation
  /// worker (unas-order-deletion-reconciliation.service.ts) - both call
  /// this exact same method, never a separate/duplicated implementation.
  ///
  /// What it does, in one Serializable transaction (retried as a whole on
  /// a genuine Postgres conflict, same as apply()/refreshOrder() above):
  ///  1. locks this exact order (lockUnasOrder) - the same order-level
  ///     advisory lock applyOrderStockDelta already relies on, so this can
  ///     never race a concurrent apply()/refreshOrder() sighting of the
  ///     SAME order, nor a second, parallel reconciliation attempt for it;
  ///  2. if already unasDeletedAt (a previous call already reconciled it -
  ///     manual refresh and the automatic worker can genuinely race each
  ///     other for the same order), returns immediately - alreadyReconciled:
  ///     true, reversed: false - no re-processing, no second RETURN_IN;
  ///  3. otherwise posts targetOut=empty through the EXACT SAME
  ///     applyOrderStockDelta the CANCELLED-transition branch above uses -
  ///     never a second, independent stock-reversal code path. This nets
  ///     out to reversing only whatever net quantity is STILL booked out
  ///     per the ledger (computeBookedOutAndGeneration): an order already
  ///     fully reversed by a prior partial cancellation/edit, or already
  ///     CANCELLED via a legitimate earlier storno, correctly produces
  ///     delta=0 - changed: false - and posts NO new movement (business
  ///     rule 2's "csak a fennmaradó nettó kimenetet" / rule 9's "már
  ///     sztornózott... rendelésnél nem keletkezik új készletmozgás");
  ///  4. sets status=CANCELLED (matches the same terminal/inactive
  ///     handling a real storno gets) AND unasDeletedAt=now() - the field
  ///     that actually distinguishes "physically deleted" from "properly
  ///     sztornózott in UNAS" (see SalesOrder.unasDeletedAt's own doc
  ///     comment) - both written together with the delta in the SAME
  ///     transaction, so a crash/rollback can never leave the order status
  ///     and the stock ledger disagreeing with each other.
  ///
  /// The order row itself is NEVER deleted - only ever marked. Its lines,
  /// prior StockMovement history, and this new RETURN_IN movement (when
  /// one is posted) remain permanently in place as the audit trail.
  async reconcileDeletedOrder(
    orderId: string,
    unasKey: string,
  ): Promise<{ reversed: boolean; alreadyReconciled: boolean }> {
    return retryOnSerializationConflict(() =>
      this.syncDatabase.$transaction(
        async (transaction) => {
          await lockUnasOrder(transaction, unasKey);

          const existing = await transaction.salesOrder.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              unasInvoiceStatus: true,
              unasDeletedAt: true,
              lines: {
                select: {
                  id: true,
                  sku: true,
                  variantId: true,
                  quantity: true,
                  syncStatus: true,
                  unasRemovedAt: true,
                },
              },
            },
          });
          if (!existing) {
            throw new NotFoundException("A rendelés nem található.");
          }
          if (existing.unasDeletedAt) {
            return { reversed: false, alreadyReconciled: true };
          }

          const warehouse = await ensureMainWarehouse(transaction);
          const deltaResult = await this.applyOrderStockDelta(transaction, {
            orderId: existing.id,
            unasKey,
            warehouseId: warehouse.id,
            targetOut: new Map(),
            variantMeta: this.buildVariantMeta(existing.lines, []),
            sourceProcess: "UNAS_ORDER_DELETED",
          });

          await transaction.salesOrder.update({
            where: { id: existing.id },
            data: {
              status: "CANCELLED",
              unasDeletedAt: new Date(),
            },
          });

          return { reversed: deltaResult.changed, alreadyReconciled: false };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        },
      ),
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
    const { lineInputs } = await buildLineInputs(transaction, order);
    const totals = orderTotals(order);
    const newStatus = mapUnasOrderStatus(order.statusType);

    const orderRow = await transaction.salesOrder.create({
      data: {
        orderNumber: `UNAS-${order.key}`,
        channel: "UNAS",
        status: newStatus,
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

    // targetOut is empty (not aggregateTargetOut(lineInputs, null)) when the
    // order already arrives CANCELLED/close_fault on its very FIRST sighting
    // - a real, previously-latent bug this rewrite fixes as a byproduct of
    // the unified model: the old code unconditionally created a SALE
    // movement for a brand-new order's stock lines regardless of status,
    // which for an order that's already dead on arrival could never be
    // reversed afterwards (the ACTIVE->CANCELLED transition branch never
    // fires for an order that's CANCELLED from birth). Under the delta
    // model, bookedOut is empty for a brand-new order either way, so
    // targetOut=empty simply yields delta=0 for every variant - no
    // movement, no outbox row, nothing to ever need reversing.
    const targetOut =
      newStatus === "CANCELLED"
        ? new Map<string, Prisma.Decimal>()
        : aggregateTargetOut(lineInputs, null);
    await this.applyOrderStockDelta(transaction, {
      orderId: orderRow.id,
      unasKey: order.key,
      warehouseId,
      targetOut,
      variantMeta: this.buildVariantMeta([], lineInputs),
      sourceProcess: "UNAS_ORDER_IMPORT",
    });

    await transaction.externalReference.create({
      data: {
        system: "UNAS",
        entityType: "SalesOrder",
        entityId: orderRow.id,
        // externalId = UNAS's stable Id (never reassigned), externalKey =
        // UNAS's reassignable Key - see UnasApiOrder.id's own doc-comment
        // and findExternalReferenceForOrder above for why these must stay
        // distinct from this checkpoint onward. Falls back to `key` only
        // if a response is ever missing `Id` entirely (defensive; not
        // expected per UNAS's own docs) - this exactly matches every
        // pre-existing row's convention, so it degrades to the same
        // (imperfect, but no worse than before) behavior rather than
        // crashing the import.
        externalId: order.id ?? order.key,
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

  /// Refreshes existing active SalesOrderLine rows' pricing/description,
  /// one-to-one within each SKU, and adds rows for fresh unmatched items.
  /// Lines absent from the new UNAS payload are preserved as audit history
  /// with unasRemovedAt set; they stop contributing to active counts and to
  /// aggregateTargetOut, which drives the matching RETURN_IN delta.
  /// `lineInputs` is computed once by the caller (buildLineInputs) and
  /// passed in rather than recomputed here, since the caller also needs it
  /// for the stock-delta step right afterward.
  private async syncLines(
    transaction: UnasOrderSyncTransaction,
    existing: OrderRow,
    lineInputs: LineInput[],
    syncedAt: Date,
  ): Promise<void> {
    const matchedIds = new Set<string>();
    for (const { input, match } of matchLineInputs(
      lineInputs,
      existing.lines,
    )) {
      if (match) {
        matchedIds.add(match.id);
        // effectiveVariantId mirrors resolveEffectiveVariantId exactly (see
        // that function's doc comment) - computed inline here as the actual
        // Prisma update payload rather than calling it twice, but must stay
        // logically identical to what aggregateTargetOut derives for the
        // same (match, input) pair.
        await transaction.salesOrderLine.update({
          where: { id: match.id },
          data: {
            description: input.description,
            quantity: input.quantity,
            unit: input.unit,
            unitNet: input.unitNet,
            taxRate: input.taxRate,
            lineGross: input.lineGross,
            ...(input.isTechnicalCost
              ? { variantId: null, syncStatus: "OK", syncError: null }
              : match.syncStatus === "FAILED" && input.syncStatus === "OK"
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

    for (const line of existing.lines) {
      if (line.unasRemovedAt || matchedIds.has(line.id)) continue;
      await transaction.salesOrderLine.update({
        where: { id: line.id },
        data: { unasRemovedAt: syncedAt },
      });
    }
  }

  /// Sku/unit lookup for the outbox's denormalized fields, merging the
  /// CURRENT sighting's lines (preferred) with the order's pre-existing
  /// lines (fallback - covers a variant that only appears in `bookedOut`
  /// because its line vanished from the current UNAS payload entirely, e.g.
  /// a full cancellation or a removed order line).
  private buildVariantMeta(
    existingLines: OrderLineRow[],
    lineInputs: LineInput[],
  ): Map<string, { sku: string; unit: string }> {
    const meta = new Map<string, { sku: string; unit: string }>();
    for (const line of existingLines) {
      if (line.variantId)
        meta.set(line.variantId, { sku: line.sku, unit: "db" });
    }
    for (const input of lineInputs) {
      for (const stockTarget of input.stockTargets) {
        meta.set(stockTarget.variantId, {
          sku: stockTarget.sku,
          unit: stockTarget.unit,
        });
      }
    }
    return meta;
  }

  /// Derives, straight from the StockMovement/StockMovementLine ledger, how
  /// much of each variant this specific order has NET already removed from
  /// stock so far ("bookedOut" - positive = taken out, matching the sign
  /// convention targetOut uses) - deliberately never SalesOrderLine.quantity,
  /// which is just the order's CURRENT stated quantity, not a record of what
  /// was actually posted. SALE movements count positively (they reduced
  /// on-hand for this order), RETURN_IN movements count negatively (they
  /// gave stock back) - summed per variant across every movement this exact
  /// order (referenceType/referenceId) has ever produced. Resilient to
  /// partial/interrupted previous imports, replays, and multi-line-per-
  /// variant movements by construction: it is a plain aggregation of
  /// whatever actually got committed, nothing more. Also returns
  /// `generation` (the movement count itself) for the idempotency-key
  /// scheme - see applyOrderStockDelta's own doc comment for why a
  /// ledger-derived counter is used instead of a content hash.
  private async computeBookedOutAndGeneration(
    transaction: Pick<UnasOrderSyncTransaction, "stockMovement">,
    orderId: string,
  ): Promise<{ bookedOut: Map<string, Prisma.Decimal>; generation: number }> {
    const movements = await transaction.stockMovement.findMany({
      where: {
        referenceType: "SalesOrder",
        referenceId: orderId,
        type: { in: ["SALE", "RETURN_IN"] },
      },
      select: {
        type: true,
        lines: { select: { variantId: true, quantity: true } },
      },
    });
    // Sign convention (SALE=+1 "taken out", RETURN_IN=-1 "given back") lives
    // in common/stock-ledger.util.ts's sumOrderBookedOut - shared verbatim
    // with the read-only historical order audit
    // (unas-order-stock-audit.service.ts), so the two can never silently
    // disagree on what "already booked" means for the same order.
    const bookedOut = sumOrderBookedOut(movements);
    return { bookedOut, generation: movements.length };
  }

  /// The unified UNAS webshop stock-delta engine - the single place every
  /// order-stock-affecting event (initial import, an active order's
  /// quantity/linkage edit, or a cancellation) funnels through. For each
  /// variant relevant to this order (union of `targetOut`'s keys and the
  /// ledger's own `bookedOut` keys - so a variant whose line vanished
  /// entirely, or a full cancellation with an empty targetOut, is still
  /// considered), computes `delta = target - alreadyBooked` and posts
  /// exactly that much through the shared postInventoryMovement primitive -
  /// never a second, independent write path. A positive delta (need to
  /// remove MORE from stock) becomes part of one SALE movement; a negative
  /// delta (need to give some back) becomes part of one RETURN_IN movement;
  /// both can legitimately happen in the SAME call (e.g. one line's quantity
  /// went up while another's went down) and are posted as two separate
  /// movements in the same transaction, since StockMovement.type is a single
  /// value per movement. delta=0 for every variant is a true no-op: no
  /// movement, no outbox row, not even a call into postInventoryMovement.
  ///
  /// Idempotency key: `UNAS_ORDER:<key>:g<generation>:<SALE|RETURN>`, where
  /// `generation` is the COUNT of SALE/RETURN_IN movements this order has
  /// produced so far (from computeBookedOutAndGeneration, read under the
  /// order-level advisory lock below) rather than a content hash of the
  /// order's state. This is a deliberate simplification: the brief's own
  /// example key (`UNAS_ORDER:<key>:<canonicalInventoryStateHash>`) has a
  /// real correctness gap the brief itself flags - state A -> B -> A would
  /// hash back to the SAME key on the second A, and postInventoryMovement's
  /// idempotency check would then wrongly treat the second, legitimate A
  /// transition as an already-applied replay of the first. A ledger-derived
  /// monotonic generation counter sidesteps this without needing a second
  /// "transition version" field alongside the hash: it strictly increases by
  /// exactly one (or two, if both a SALE and a RETURN post in the same
  /// call) every time this function actually posts something, is read
  /// consistently under the SAME order-level lock and (for apply()'s batch
  /// path) the same Serializable transaction that computed the delta, and
  /// needs no schema change or stored hash at all. A genuine retry of the
  /// exact same attempt (e.g. a crashed worker re-processing the same
  /// order before any new sighting arrives) recomputes the SAME delta
  /// against the SAME generation and is naturally deduped by
  /// postInventoryMovement's own idempotencyKey check; a later, distinct
  /// transition always sees a higher generation and gets a fresh key.
  private async applyOrderStockDelta(
    transaction: UnasOrderSyncTransaction,
    params: {
      orderId: string;
      unasKey: string;
      warehouseId: string;
      targetOut: Map<string, Prisma.Decimal>;
      variantMeta: Map<string, { sku: string; unit: string }>;
      sourceProcess: InventoryMovementSourceProcess;
    },
  ): Promise<{ changed: boolean }> {
    // Serializes every stock-delta computation/posting for this exact order
    // - MUST be acquired before reading the ledger below, or two concurrent
    // sightings (batch tick + manual refresh) could both read the same
    // "already booked" snapshot and each post the same delta.
    await lockUnasOrder(transaction, params.unasKey);

    const { bookedOut, generation } = await this.computeBookedOutAndGeneration(
      transaction,
      params.orderId,
    );

    const saleLines: InventoryMovementLineInput[] = [];
    const returnLines: InventoryMovementLineInput[] = [];
    const variantIds = new Set([
      ...params.targetOut.keys(),
      ...bookedOut.keys(),
    ]);
    const variants =
      variantIds.size > 0
        ? await transaction.productVariant.findMany({
            where: { id: { in: [...variantIds] } },
            select: {
              id: true,
              sku: true,
              unit: true,
              product: {
                select: {
                  catalogAuthority: true,
                  unasSnapshot: { select: { isPackageProduct: true } },
                },
              },
            },
          })
        : [];
    const liveVariantMeta = new Map(
      variants.map((variant) => [
        variant.id,
        {
          sku: variant.sku,
          unit: variant.unit,
          syncToUnas:
            isUnasMasteredVariant(variant) &&
            !variant.product.unasSnapshot?.isPackageProduct,
        },
      ]),
    );
    for (const variantId of variantIds) {
      const target = params.targetOut.get(variantId) ?? new Prisma.Decimal(0);
      const booked = bookedOut.get(variantId) ?? new Prisma.Decimal(0);
      const delta = target.minus(booked);
      if (delta.isZero()) continue;
      const fallback = params.variantMeta.get(variantId);
      const meta = liveVariantMeta.get(variantId) ?? {
        sku: fallback?.sku ?? variantId,
        unit: fallback?.unit ?? "db",
        // Missing catalog metadata is not safe to publish externally.
        syncToUnas: false,
      };
      if (delta.isPositive()) {
        // Need to remove `delta` MORE from stock than already booked.
        saleLines.push({
          variantId,
          sku: meta.sku,
          quantityDelta: delta.negated(),
          unit: meta.unit,
          syncToUnas: meta.syncToUnas,
        });
      } else {
        // delta is negative: need to give back `abs(delta)`.
        returnLines.push({
          variantId,
          sku: meta.sku,
          quantityDelta: delta.negated(),
          unit: meta.unit,
          syncToUnas: meta.syncToUnas,
        });
      }
    }

    if (saleLines.length === 0 && returnLines.length === 0) {
      return { changed: false };
    }

    if (saleLines.length > 0) {
      await postInventoryMovement(transaction, {
        idempotencyKey: `UNAS_ORDER:${params.unasKey}:g${generation}:SALE`,
        movementNumber: `WEBSHOP-${params.unasKey}-g${generation}-SALE`,
        type: "SALE",
        warehouseId: params.warehouseId,
        referenceType: "SalesOrder",
        referenceId: params.orderId,
        sourceProcess: params.sourceProcess,
        lines: saleLines,
      });
    }
    if (returnLines.length > 0) {
      await postInventoryMovement(transaction, {
        idempotencyKey: `UNAS_ORDER:${params.unasKey}:g${generation}:RETURN`,
        movementNumber: `WEBSHOP-${params.unasKey}-g${generation}-RETURN`,
        type: "RETURN_IN",
        warehouseId: params.warehouseId,
        referenceType: "SalesOrder",
        referenceId: params.orderId,
        sourceProcess: params.sourceProcess,
        lines: returnLines,
      });
    }
    return { changed: true };
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
      /// Named so the query matches the seam's declared row. Without it the
      /// type is narrower than what Prisma returns - which is the SAFE
      /// direction (it hides fields that exist rather than promising fields
      /// that do not), and that is exactly why it survives unnoticed. The
      /// findUnique on this seam had the same shape and a second, conflicting
      /// declaration next to it, and the pair is what caused real drift.
      select: { entityId: true, metadata: true },
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
      where: {
        unasSnapshot: {
          reportedStock: { not: null },
          isPackageProduct: false,
        },
      },
      select: {
        id: true,
        name: true,
        unasSnapshot: {
          select: {
            reportedStock: true,
            reportedStockSyncedAt: true,
            isPackageProduct: true,
          },
        },
        variants: {
          where: { isActive: true },
          select: {
            id: true,
            sku: true,
            unasReportedStock: true,
            unasReportedStockSyncedAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    const variantIds = products.flatMap((product) =>
      product.variants.map((variant) => variant.id),
    );
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
    const mismatches = products.flatMap((product) =>
      product.variants.flatMap((variant) => {
        if (!onHandByVariant.has(variant.id)) return [];
        const reportedStock =
          variant.unasReportedStock ?? product.unasSnapshot?.reportedStock;
        if (reportedStock === null || reportedStock === undefined) return [];
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
              variant.unasReportedStockSyncedAt?.toISOString() ??
              product.unasSnapshot?.reportedStockSyncedAt?.toISOString() ??
              null,
          },
        ];
      }),
    );

    return {
      checkedAt: new Date().toISOString(),
      checkedCount: variantIds.filter((variantId) =>
        onHandByVariant.has(variantId),
      ).length,
      mismatches,
    };
  }
}
