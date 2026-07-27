import { randomUUID } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceSource,
} from "@acropora/types";

import {
  isDuplicateMovementIdempotencyKeyError,
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import type { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import {
  purchaseInvoiceDetailInclude,
  purchaseInvoiceSummaryInclude,
  toPurchaseInvoiceDetail,
  toPurchaseInvoiceSummary,
  type PurchaseInvoiceDetailRow,
  type PurchaseInvoiceSummaryRow,
} from "./purchase-invoice.types.js";

/// True for a P2002 on PurchaseInvoice's own (supplierId,
/// supplierInvoiceNumber) unique constraint - i.e. the same real-world
/// supplier invoice was already posted once (this IS the idempotency
/// boundary for this flow, see CreatePurchaseInvoiceParams' idempotencyKey
/// doc comment). Deliberately narrower than a blanket "any P2002 during
/// invoice creation" check, so an (astronomically unlikely) documentNumber
/// collision isn't misreported as "duplicate invoice".
function isDuplicateSupplierInvoiceError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta?.target ?? "").includes("supplierInvoiceNumber")
  );
}

export interface PurchaseInvoiceVariantInfo {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  /** Best known current quantity: local StockItem, falling back to 0. */
  currentQty: Prisma.Decimal;
}

export interface PurchaseInvoiceCurrentStock {
  warehouseId: string;
  variants: Map<string, PurchaseInvoiceVariantInfo>;
}

export interface CreatePurchaseInvoiceLine {
  /** Nincs, ha a tétel nincs a terméktörzsben - ilyenkor nincs helyi készlethatás/UNAS push. */
  variantId: string | null;
  /** UNAS SKU a variantId-hez; kötelező amikor variantId nem null (kell a
   * postInventoryMovement-nek/UnasStockSyncOutbox-nak), egyébként null. */
  sku: string | null;
  sourceDescription: string | null;
  orderedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal;
  unit: string;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  /// "PENDING" a helyi könyvelést és a UnasStockSyncOutbox-publikálást
  /// megelőlegezve (a tényleges UNAS-push a háttér-workeré, lásd
  /// PurchasingService.createInvoice), "NOT_LINKED" változatlanul a
  /// terméktörzsben nem szereplő tételeknél. Már sosem "OK"/"FAILED" itt -
  /// azt egy szinkron UNAS-hívás eredménye adta korábban, ami megszűnt.
  syncStatus: "PENDING" | "NOT_LINKED";
  syncError: string | null;
}

export interface CreatePurchaseInvoiceParams {
  documentNumber: string;
  supplierInvoiceNumber: string;
  source: PurchaseInvoiceSource;
  supplierId: string;
  warehouseId: string;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  invoiceDate: Date;
  dueDate: Date | null;
  isPaid: boolean;
  paidAt: Date | null;
  vatRate: Prisma.Decimal | null;
  note: string | null;
  /** Ha a számla egy NAV bejövő számla bevételezéseként jön létre - a mentés a NavIncomingInvoice-ot RECEIVED állapotba állítja és összeköti ezzel a számlával. */
  navIncomingInvoiceId?: string;
  actorUserId: string;
  lines: CreatePurchaseInvoiceLine[];
}

interface PurchaseInvoiceCreateTransaction extends InventoryMovementDatabase {
  purchaseInvoice: {
    create(args: unknown): Promise<PurchaseInvoiceDetailRow>;
  };
  productExtension: {
    upsert(args: unknown): Promise<unknown>;
  };
  navIncomingInvoice: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  domainEvent: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface PurchaseInvoiceDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        product: {
          name: string;
          unasSnapshot: { reportedStock: Prisma.Decimal | null } | null;
        };
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  purchaseInvoice: {
    findMany(args: unknown): Promise<PurchaseInvoiceSummaryRow[]>;
    findUnique(args: unknown): Promise<PurchaseInvoiceDetailRow | null>;
    count(args: unknown): Promise<number>;
  };
  $transaction<T>(
    operation: (transaction: PurchaseInvoiceCreateTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable"; timeout?: number },
  ): Promise<T>;
}

export const PURCHASE_INVOICE_DATABASE = Symbol("PURCHASE_INVOICE_DATABASE");

@Injectable()
export class PurchaseInvoiceRepository extends Repository {
  private readonly invoiceDatabase: PurchaseInvoiceDatabase;

  constructor(
    @Optional()
    @Inject(PURCHASE_INVOICE_DATABASE)
    invoiceDatabase?: PurchaseInvoiceDatabase,
  ) {
    super(prisma);
    this.invoiceDatabase =
      invoiceDatabase ?? (prisma as unknown as PurchaseInvoiceDatabase);
  }

  async currentStock(
    variantIds: string[],
  ): Promise<PurchaseInvoiceCurrentStock> {
    const warehouse = await ensureMainWarehouse(this.invoiceDatabase);
    if (variantIds.length === 0) {
      return { warehouseId: warehouse.id, variants: new Map() };
    }

    const variants = await this.invoiceDatabase.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        unit: true,
        product: {
          select: {
            name: true,
            unasSnapshot: { select: { reportedStock: true } },
          },
        },
      },
    });
    const stockItems = await this.invoiceDatabase.stockItem.findMany({
      where: {
        warehouseId: warehouse.id,
        locationId: null,
        lotId: null,
        variantId: { in: variantIds },
      },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map(
      stockItems.map((item) => [item.variantId, item.onHand]),
    );

    const result = new Map<string, PurchaseInvoiceVariantInfo>();
    for (const variant of variants) {
      result.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        unit: variant.unit,
        // A helyi StockItem ledger csak leltár-korrekció vagy POS eladás
        // után kap sort egy variantra; addig az egyetlen ismert "jelenlegi
        // mennyiség" a UNAS reported stock snapshot - enélkül az első
        // beszerzés a UNAS-ba a valós készlet helyett csak a bevételezett
        // mennyiséget írná ki, felülírva a régit (lásd inventory-count.repository.ts
        // ugyanerre a mintára).
        currentQty:
          onHandByVariant.get(variant.id) ??
          variant.product.unasSnapshot?.reportedStock ??
          new Prisma.Decimal(0),
      });
    }
    return { warehouseId: warehouse.id, variants: result };
  }

  /// Stabil, a valós üzleti eseményből (nem véletlenszerűen) származó
  /// idempotenciakulcs a postInventoryMovement számára. A
  /// (supplierId, supplierInvoiceNumber) pár már ma is egyedi a
  /// PurchaseInvoice táblán (@@unique) - ez a beszerzés flow tényleges
  /// dupla-beküldés elleni védelme (l. isDuplicateSupplierInvoiceError
  /// lejjebb): egy megismételt kérés a PurchaseInvoice.create()-nél
  /// megbukik P2002-vel, még mielőtt a postInventoryMovement egyáltalán
  /// lefutna. A StockMovement saját idempotencyKey-je ugyanerre a párra
  /// épül, hogy a másik két flow-val (leltár, POS) egységes maradjon a
  /// minta, és hogy egy elméleti részleges-tranzakció utáni retry esetén
  /// (más documentNumber-rel, mert azt a service minden hívásnál újra
  /// generálja) is ugyanazt a mozgást ismerje fel újraként.
  private buildIdempotencyKey(params: CreatePurchaseInvoiceParams): string {
    return `PURCHASE_INVOICE:${params.supplierId}:${params.supplierInvoiceNumber}`;
  }

  async create(
    params: CreatePurchaseInvoiceParams,
  ): Promise<PurchaseInvoiceDetail> {
    const now = new Date();
    let created: PurchaseInvoiceDetailRow;
    try {
      created = await this.invoiceDatabase.$transaction(
        async (transaction) => {
          const invoice = await transaction.purchaseInvoice.create({
            data: {
              documentNumber: params.documentNumber,
              supplierInvoiceNumber: params.supplierInvoiceNumber,
              source: params.source,
              status: "POSTED",
              supplierId: params.supplierId,
              warehouseId: params.warehouseId,
              currency: params.currency,
              exchangeRate: params.exchangeRate,
              invoiceDate: params.invoiceDate,
              dueDate: params.dueDate,
              isPaid: params.isPaid,
              paidAt: params.paidAt,
              vatRate: params.vatRate,
              note: params.note,
              createdById: params.actorUserId,
              lines: {
                create: params.lines.map((line) => ({
                  variantId: line.variantId,
                  sourceDescription: line.sourceDescription,
                  orderedQuantity: line.orderedQuantity,
                  actualQuantity: line.actualQuantity,
                  unit: line.unit,
                  unitNet: line.unitNet,
                  discountPercent: line.discountPercent,
                  syncStatus: line.syncStatus,
                  syncError: line.syncError,
                })),
              },
            },
            include: purchaseInvoiceDetailInclude,
          });

          if (params.navIncomingInvoiceId) {
            // Atomi: csak akkor RECEIVED-eli a NAV bejövő számlát, ha még nem
            // volt bevételezve - kizárja, hogy ugyanaz a NAV számla két
            // beszerzési bizonylathoz is hozzákötődjön versenyhelyzetben.
            const linked = await transaction.navIncomingInvoice.updateMany({
              where: {
                id: params.navIncomingInvoiceId,
                status: { not: "RECEIVED" },
              },
              data: { status: "RECEIVED", purchaseInvoiceId: invoice.id },
            });
            if (linked.count !== 1)
              throw new ConflictException("NAV_INVOICE_ALREADY_RECEIVED");
          }

          // Csak a terméktörzsben szereplő (NOT_LINKED-nek NEM jelölt)
          // tételek hatnak a helyi készletre és kapnak
          // UnasStockSyncOutbox-sort - a régi kód is ezt csinálta
          // (`if (!line.variantId) continue`), csak most a shared writer
          // végzi a mozgás/StockItem/outbox írását EGYETLEN, ugyanebben a
          // tranzakcióban futó hívással, szinkron UNAS-hívás nélkül.
          const linkedLines = params.lines.filter(
            (line): line is CreatePurchaseInvoiceLine & { variantId: string; sku: string } =>
              Boolean(line.variantId),
          );

          if (linkedLines.length > 0) {
            await postInventoryMovement(transaction, {
              idempotencyKey: this.buildIdempotencyKey(params),
              movementNumber: `BESZMOZG-${invoice.documentNumber}`,
              type: "PURCHASE_RECEIPT",
              warehouseId: params.warehouseId,
              referenceType: "PurchaseInvoice",
              referenceId: invoice.id,
              performedById: params.actorUserId,
              occurredAt: params.invoiceDate,
              sourceProcess: "PURCHASE_INVOICE",
              lines: linkedLines.map((line) => ({
                variantId: line.variantId,
                sku: line.sku ?? line.variantId,
                // Bevételezés mindig növeli a készletet - a felhasználó
                // által beírt tényleges (nem a rendelt!) mennyiséggel.
                quantityDelta: line.actualQuantity,
                unit: line.unit,
              })),
            });

            for (const line of linkedLines) {
              await transaction.productExtension.upsert({
                where: { variantId: line.variantId },
                update: {
                  lastPurchaseNetPrice: line.unitNet,
                  defaultPurchaseCurrency: params.currency,
                  preferredSupplierId: params.supplierId,
                },
                create: {
                  variantId: line.variantId,
                  lastPurchaseNetPrice: line.unitNet,
                  defaultPurchaseCurrency: params.currency,
                  preferredSupplierId: params.supplierId,
                },
              });
            }
          }

          await transaction.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "purchase_invoice.posted",
              aggregateType: "PurchaseInvoice",
              aggregateId: invoice.id,
              actorUserId: params.actorUserId,
              payload: {
                documentNumber: invoice.documentNumber,
                source: invoice.source,
                supplierId: invoice.supplierId,
                lineCount: params.lines.length,
              },
              occurredAt: now,
              schemaVersion: 1,
            },
          });

          return invoice;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        },
      );
    } catch (error) {
      if (
        isDuplicateSupplierInvoiceError(error) ||
        isDuplicateMovementIdempotencyKeyError(error)
      ) {
        throw new ConflictException(
          "Ez a beszállítói számla (szám alapján) már rögzítve van - ismételt beküldés nem hoz létre új bizonylatot.",
        );
      }
      throw error;
    }

    return toPurchaseInvoiceDetail(created);
  }

  async list(
    query: PurchaseInvoiceListQueryDto,
  ): Promise<PurchaseInvoiceListResponse> {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                documentNumber: { contains: query.search, mode: "insensitive" },
              },
              {
                supplierInvoiceNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                supplier: {
                  name: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [invoices, totalItems] = await Promise.all([
      this.invoiceDatabase.purchaseInvoice.findMany({
        where,
        include: purchaseInvoiceSummaryInclude,
        orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.invoiceDatabase.purchaseInvoice.count({ where }),
    ]);
    return {
      items: invoices.map(toPurchaseInvoiceSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<PurchaseInvoiceDetail | null> {
    const invoice = await this.invoiceDatabase.purchaseInvoice.findUnique({
      where: { id },
      include: purchaseInvoiceDetailInclude,
    });
    return invoice ? toPurchaseInvoiceDetail(invoice) : null;
  }
}
