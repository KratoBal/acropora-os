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
  buildOutboxIdempotencyKey,
  isDuplicateMovementIdempotencyKeyError,
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { availableToSell } from "../inventory/available-to-sell.js";
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
///
/// Uses the structural (non-`instanceof`) check from prisma-error.util.ts -
/// see that file's doc comment for why `instanceof
/// Prisma.PrismaClientKnownRequestError` can't be relied on to narrow
/// `error` in this environment.
function isDuplicateSupplierInvoiceError(error: unknown): boolean {
  return isPrismaUniqueConstraintViolation(error, "supplierInvoiceNumber");
}

function isDuplicateLocalProductSkuError(error: unknown): boolean {
  return isPrismaUniqueConstraintViolation(error, "sku");
}

const LOCAL_PRODUCT_SKU_PREFIX = "ACR-L-";
const LOCAL_PRODUCT_SKU_PAD_LENGTH = 6;
const LOCAL_PRODUCT_SKU_MAX_ATTEMPTS = 3;

function formatLocalProductSku(value: bigint): string {
  return `${LOCAL_PRODUCT_SKU_PREFIX}${value
    .toString()
    .padStart(LOCAL_PRODUCT_SKU_PAD_LENGTH, "0")}`;
}

export interface PurchaseInvoiceVariantInfo {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  /** Best known current quantity: local StockItem, falling back to 0. */
  currentQty: Prisma.Decimal;
  catalogAuthority: "UNAS" | "ACROPORA" | null;
  isPackageProduct: boolean;
}

export interface PurchaseInvoiceCurrentStock {
  warehouseId: string;
  variants: Map<string, PurchaseInvoiceVariantInfo>;
}

export interface CreatePurchaseInvoiceLine {
  /** Nincs, ha a tétel nincs a terméktörzsben - ilyenkor nincs helyi készlethatás/UNAS push. */
  variantId: string | null;
  /** Belső SKU a variantId-hez; kötelező amikor variantId nem null (kell a
   * postInventoryMovement-nek, UNAS-authority terméknél pedig az
   * UnasStockSyncOutbox-nak), egyébként null. */
  sku: string | null;
  /** Ha jelen van, a repository a számlával azonos tranzakcióban hozza
   * létre a LOCAL/ACROPORA terméket és első variantját. */
  createLocalProduct: {
    name: string;
    primaryCategoryId: string | null;
  } | null;
  sourceDescription: string | null;
  orderedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal;
  unit: string;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  /// "PENDING" a helyi könyvelést és a UnasStockSyncOutbox-publikálást
  /// megelőlegezve (a tényleges UNAS-push a háttér-workeré, lásd
  /// PurchasingService.createInvoice), "NOT_APPLICABLE" helyi terméknél,
  /// "NOT_LINKED" pedig terméktörzs nélkül hagyott sornál.
  syncStatus: "PENDING" | "NOT_LINKED" | "NOT_APPLICABLE";
  syncError: string | null;
  syncToUnas: boolean;
  projectAllocations?: Array<{
    projectId: string;
    quantity: Prisma.Decimal;
  }>;
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
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  product: {
    create(args: unknown): Promise<{
      id: string;
      name: string;
      origin: "LOCAL";
      catalogAuthority: "ACROPORA";
      variants: Array<{ id: string; sku: string; unit: string }>;
    }>;
  };
  purchaseInvoice: {
    create(args: unknown): Promise<PurchaseInvoiceDetailRow>;
    findUnique(args: unknown): Promise<PurchaseInvoiceDetailRow | null>;
  };
  productExtension: {
    upsert(args: unknown): Promise<unknown>;
  };
  project: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  projectInventoryReservation: {
    create(args: unknown): Promise<{ id: string }>;
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
          catalogAuthority: "UNAS" | "ACROPORA" | null;
          unasSnapshot: {
            reportedStock: Prisma.Decimal | null;
            isPackageProduct: boolean;
          } | null;
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
            catalogAuthority: true,
            unasSnapshot: {
              select: { reportedStock: true, isPackageProduct: true },
            },
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
        catalogAuthority: variant.product.catalogAuthority,
        isPackageProduct:
          variant.product.unasSnapshot?.isPackageProduct ?? false,
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

  private async nextLocalProductSku(
    transaction: PurchaseInvoiceCreateTransaction,
  ): Promise<string> {
    const rows = await transaction.$queryRaw<Array<{ value: bigint }>>(
      Prisma.sql`SELECT nextval('"LocalProductSkuSequence"') AS value`,
    );
    const value = rows[0]?.value;
    if (value === undefined)
      throw new Error("LOCAL_PRODUCT_SKU_SEQUENCE_FAILED");
    return formatLocalProductSku(value);
  }

  async create(
    params: CreatePurchaseInvoiceParams,
  ): Promise<PurchaseInvoiceDetail> {
    const now = new Date();
    let created: PurchaseInvoiceDetailRow | undefined;
    for (
      let attempt = 1;
      attempt <= LOCAL_PRODUCT_SKU_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        created = await this.invoiceDatabase.$transaction(
          async (transaction) => {
            const localProducts: Array<{
              productId: string;
              variantId: string;
              sku: string;
              name: string;
            }> = [];
            const resolvedLines: CreatePurchaseInvoiceLine[] = [];

            for (const line of params.lines) {
              if (!line.createLocalProduct) {
                resolvedLines.push(line);
                continue;
              }

              const requestedLocalProduct = line.createLocalProduct;
              const sku = await this.nextLocalProductSku(transaction);
              const local = await transaction.product.create({
                data: {
                  name: requestedLocalProduct.name,
                  type: "PHYSICAL",
                  origin: "LOCAL",
                  catalogAuthority: "ACROPORA",
                  createdById: params.actorUserId,
                  categoryId: requestedLocalProduct.primaryCategoryId,
                  ...(requestedLocalProduct.primaryCategoryId
                    ? {
                        categories: {
                          create: {
                            categoryId: requestedLocalProduct.primaryCategoryId,
                            isPrimary: true,
                            source: "MANUAL",
                          },
                        },
                      }
                    : {}),
                  variants: {
                    create: {
                      sku,
                      unit: line.unit,
                    },
                  },
                },
                select: {
                  id: true,
                  name: true,
                  origin: true,
                  catalogAuthority: true,
                  variants: {
                    select: { id: true, sku: true, unit: true },
                    take: 1,
                  },
                },
              });
              const variant = local.variants[0];
              if (!variant)
                throw new Error("LOCAL_PRODUCT_VARIANT_CREATION_FAILED");

              localProducts.push({
                productId: local.id,
                variantId: variant.id,
                sku: variant.sku,
                name: local.name,
              });
              resolvedLines.push({
                ...line,
                variantId: variant.id,
                sku: variant.sku,
                createLocalProduct: null,
                syncStatus: "NOT_APPLICABLE",
                syncToUnas: false,
              });
            }

            const persistedLines: Array<
              CreatePurchaseInvoiceLine & {
                purchaseInvoiceLineId: string;
              }
            > = resolvedLines.map((line) => ({
              ...line,
              purchaseInvoiceLineId: randomUUID(),
            }));

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
                  create: persistedLines.map((line) => ({
                    id: line.purchaseInvoiceLineId,
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

            // Minden termékhez kapcsolt sor hat a helyi készletre. UNAS
            // outbox-sort viszont csak az authority alapján
            // syncToUnas=true sorok kapnak; helyi termék soha.
            const linkedLines = persistedLines.filter(
              (
                line,
              ): line is CreatePurchaseInvoiceLine & {
                variantId: string;
                sku: string;
                purchaseInvoiceLineId: string;
              } => Boolean(line.variantId),
            );

            if (linkedLines.length > 0) {
              const movementLinesByVariant = new Map<
                string,
                {
                  variantId: string;
                  sku: string;
                  quantityDelta: Prisma.Decimal;
                  unit: string;
                  syncToUnas: boolean;
                }
              >();
              for (const line of linkedLines) {
                const existing = movementLinesByVariant.get(line.variantId);
                if (existing) {
                  existing.quantityDelta = existing.quantityDelta.plus(
                    line.actualQuantity,
                  );
                } else {
                  movementLinesByVariant.set(line.variantId, {
                    variantId: line.variantId,
                    sku: line.sku,
                    quantityDelta: line.actualQuantity,
                    unit: line.unit,
                    syncToUnas: line.syncToUnas,
                  });
                }
              }
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
                // Azonos variant több számlasoron is szerepelhet eltérő
                // egységárral; a fizikai készletmozgásban egyetlen összegzett
                // sor kell, a számlasorok és projektfoglalások ettől még
                // külön maradnak.
                lines: [...movementLinesByVariant.values()],
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

              const reservationLines = linkedLines.filter(
                (line) => (line.projectAllocations?.length ?? 0) > 0,
              );
              if (reservationLines.length > 0) {
                const projectIds = [
                  ...new Set(
                    reservationLines.flatMap((line) =>
                      (line.projectAllocations ?? []).map(
                        (allocation) => allocation.projectId,
                      ),
                    ),
                  ),
                ];
                const projects = await transaction.project.findMany({
                  where: {
                    id: { in: projectIds },
                    status: { in: ["DRAFT", "ACTIVE", "ON_HOLD"] },
                  },
                  select: { id: true },
                });
                if (projects.length !== projectIds.length)
                  throw new ConflictException(
                    "A kiválasztott projekt időközben lezárult vagy már nem fogadhat készletfoglalást.",
                  );

                for (const line of reservationLines) {
                  const stockItem = await transaction.stockItem.findFirst({
                    where: {
                      variantId: line.variantId,
                      warehouseId: params.warehouseId,
                      locationId: null,
                      lotId: null,
                    },
                    select: { id: true, onHand: true, reserved: true },
                  });
                  if (!stockItem)
                    throw new Error("PROJECT_RESERVATION_STOCK_ITEM_MISSING");

                  const reservedDelta = (line.projectAllocations ?? []).reduce(
                    (sum, allocation) => sum.plus(allocation.quantity),
                    new Prisma.Decimal(0),
                  );
                  const resultingReserved = (
                    stockItem.reserved ?? new Prisma.Decimal(0)
                  ).plus(reservedDelta);

                  for (const allocation of line.projectAllocations ?? []) {
                    const reservation =
                      await transaction.projectInventoryReservation.create({
                        data: {
                          projectId: allocation.projectId,
                          purchaseInvoiceLineId: line.purchaseInvoiceLineId,
                          stockItemId: stockItem.id,
                          variantId: line.variantId,
                          warehouseId: params.warehouseId,
                          quantity: allocation.quantity,
                          status: "ACTIVE",
                          createdById: params.actorUserId,
                        },
                        select: { id: true },
                      });
                    await transaction.domainEvent.create({
                      data: {
                        id: randomUUID(),
                        eventType: "project_inventory.reserved",
                        aggregateType: "ProjectInventoryReservation",
                        aggregateId: reservation.id,
                        actorUserId: params.actorUserId,
                        payload: {
                          projectId: allocation.projectId,
                          purchaseInvoiceId: invoice.id,
                          purchaseInvoiceLineId: line.purchaseInvoiceLineId,
                          variantId: line.variantId,
                          warehouseId: params.warehouseId,
                          quantity: allocation.quantity.toString(),
                        },
                        occurredAt: now,
                        schemaVersion: 1,
                      },
                    });
                  }

                  await transaction.stockItem.update({
                    where: { id: stockItem.id },
                    data: { reserved: resultingReserved },
                  });

                  if (line.syncToUnas) {
                    await transaction.unasStockSyncOutbox.updateMany({
                      where: {
                        idempotencyKey: buildOutboxIdempotencyKey(
                          this.buildIdempotencyKey(params),
                          line.variantId,
                        ),
                      },
                      data: {
                        targetOnHand: availableToSell({
                          onHand: stockItem.onHand,
                          reserved: resultingReserved,
                        }),
                      },
                    });
                  }
                }
              }
            }

            for (const localProduct of localProducts) {
              await transaction.domainEvent.create({
                data: {
                  id: randomUUID(),
                  eventType: "product.created",
                  aggregateType: "Product",
                  aggregateId: localProduct.productId,
                  actorUserId: params.actorUserId,
                  payload: {
                    name: localProduct.name,
                    sku: localProduct.sku,
                    variantId: localProduct.variantId,
                    origin: "LOCAL",
                    catalogAuthority: "ACROPORA",
                    createdFromPurchaseInvoiceId: invoice.id,
                  },
                  occurredAt: now,
                  schemaVersion: 1,
                },
              });
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
                  lineCount: resolvedLines.length,
                  localProductCreatedCount: localProducts.length,
                },
                occurredAt: now,
                schemaVersion: 1,
              },
            });

            const completedInvoice =
              await transaction.purchaseInvoice.findUnique({
                where: { id: invoice.id },
                include: purchaseInvoiceDetailInclude,
              });
            if (!completedInvoice)
              throw new Error("PURCHASE_INVOICE_RELOAD_FAILED");
            return completedInvoice;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30_000,
          },
        );
        break;
      } catch (error) {
        if (
          isDuplicateLocalProductSkuError(error) &&
          attempt < LOCAL_PRODUCT_SKU_MAX_ATTEMPTS
        ) {
          continue;
        }
        if (
          isDuplicateSupplierInvoiceError(error) ||
          isDuplicateMovementIdempotencyKeyError(error)
        ) {
          throw new ConflictException(
            "Ez a beszállítói számla (szám alapján) már rögzítve van - ismételt beküldés nem hoz létre új bizonylatot.",
          );
        }
        if (isDuplicateLocalProductSkuError(error)) {
          throw new ConflictException("LOCAL_PRODUCT_SKU_GENERATION_FAILED");
        }
        throw error;
      }
    }

    if (!created) throw new Error("PURCHASE_INVOICE_CREATION_FAILED");
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
