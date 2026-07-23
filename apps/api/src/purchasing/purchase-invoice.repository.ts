import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceSource,
} from "@acropora/types";

import {
  setStockItemQuantity,
  type StockItemWriterDatabase,
} from "../common/stock-item-writer.js";
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
  variantId: string;
  sourceDescription: string | null;
  orderedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal;
  unit: string;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  /** Absolute on-hand quantity after this receipt (currentQty + actualQuantity); the UNAS push for this value already happened before this call runs. */
  resultingQty: Prisma.Decimal;
  syncStatus: "OK" | "FAILED";
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
  actorUserId: string;
  lines: CreatePurchaseInvoiceLine[];
}

interface PurchaseInvoiceCreateTransaction {
  purchaseInvoice: {
    create(args: unknown): Promise<PurchaseInvoiceDetailRow>;
  };
  stockMovement: {
    create(args: unknown): Promise<{ id: string }>;
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
  };
  stockItem: StockItemWriterDatabase["stockItem"];
  productExtension: {
    upsert(args: unknown): Promise<unknown>;
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

  async create(
    params: CreatePurchaseInvoiceParams,
  ): Promise<PurchaseInvoiceDetail> {
    const now = new Date();
    const created = await this.invoiceDatabase.$transaction(
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

        const movement = await transaction.stockMovement.create({
          data: {
            movementNumber: `BESZMOZG-${invoice.documentNumber}`,
            type: "PURCHASE_RECEIPT",
            status: "POSTED",
            targetWarehouseId: params.warehouseId,
            referenceType: "PurchaseInvoice",
            referenceId: invoice.id,
            performedById: params.actorUserId,
            occurredAt: params.invoiceDate,
            postedAt: now,
          },
        });

        for (const line of params.lines) {
          await transaction.stockMovementLine.create({
            data: {
              movementId: movement.id,
              variantId: line.variantId,
              quantity: line.actualQuantity,
              unit: line.unit,
            },
          });
          await setStockItemQuantity(transaction, {
            variantId: line.variantId,
            warehouseId: params.warehouseId,
            onHand: line.resultingQty,
          });
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
