import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  PosPaymentMethod,
  PosSaleDetail,
  PosSaleListResponse,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import {
  setStockItemQuantity,
  type StockItemWriterDatabase,
} from "../common/stock-item-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import {
  toPosSaleDetail,
  toPosSaleListItem,
  type SalesOrderListWithRelations,
  type SalesOrderWithRelations,
} from "./pos-sale.types.js";

const detailInclude = {
  customer: { select: { displayName: true } },
  soldBy: { select: { displayName: true } },
  lines: true,
} as const;

const listInclude = {
  customer: { select: { displayName: true } },
  soldBy: { select: { displayName: true } },
  _count: { select: { lines: true } },
} as const;

export interface PosSaleVariantInfo {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  /** VAT rate percentage, e.g. "27". Null when neither the variant nor the UNAS snapshot has one. */
  vatRate: Prisma.Decimal | null;
  /** Best known current quantity: local StockItem, falling back to the UNAS reported stock, then 0. */
  currentQty: Prisma.Decimal;
}

export interface PosSaleCurrentStock {
  warehouseId: string;
  variants: Map<string, PosSaleVariantInfo>;
}

export interface CreatePosSaleLine {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  lineGross: Prisma.Decimal;
  /** The absolute quantity now known to remain after this sale; written to StockItem and pushed to UNAS. */
  resultingQty: Prisma.Decimal;
  syncStatus: "OK" | "FAILED";
  syncError: string | null;
}

export interface CreatePosSaleParams {
  orderNumber: string;
  warehouseId: string;
  actorUserId: string;
  paymentMethod: PosPaymentMethod;
  customerId: string | null;
  lines: CreatePosSaleLine[];
  totals: {
    totalNet: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalGross: Prisma.Decimal;
  };
}

interface PosSaleTransaction {
  salesOrder: {
    create(args: unknown): Promise<SalesOrderWithRelations>;
  };
  stockMovement: {
    create(args: unknown): Promise<{ id: string }>;
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
  };
  stockItem: StockItemWriterDatabase["stockItem"];
}

export interface PosSaleDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        vatRate: Prisma.Decimal | null;
        product: {
          name: string;
          unasSnapshot: {
            vatRate: Prisma.Decimal | null;
            reportedStock: Prisma.Decimal | null;
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
  salesOrder: {
    findMany(args: unknown): Promise<SalesOrderListWithRelations[]>;
    findUnique(args: unknown): Promise<SalesOrderWithRelations | null>;
    count(args: unknown): Promise<number>;
  };
  $transaction<T>(
    operation: (transaction: PosSaleTransaction) => Promise<T>,
  ): Promise<T>;
}

export const POS_SALE_DATABASE = Symbol("POS_SALE_DATABASE");

@Injectable()
export class PosSaleRepository extends Repository {
  private readonly saleDatabase: PosSaleDatabase;

  constructor(
    @Optional()
    @Inject(POS_SALE_DATABASE)
    saleDatabase?: PosSaleDatabase,
  ) {
    super(prisma);
    this.saleDatabase = saleDatabase ?? (prisma as unknown as PosSaleDatabase);
  }

  async currentStock(variantIds: string[]): Promise<PosSaleCurrentStock> {
    const warehouse = await ensureMainWarehouse(this.saleDatabase);
    if (variantIds.length === 0) {
      return { warehouseId: warehouse.id, variants: new Map() };
    }

    const variants = await this.saleDatabase.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        unit: true,
        vatRate: true,
        product: {
          select: {
            name: true,
            unasSnapshot: { select: { vatRate: true, reportedStock: true } },
          },
        },
      },
    });
    const stockItems = await this.saleDatabase.stockItem.findMany({
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

    const result = new Map<string, PosSaleVariantInfo>();
    for (const variant of variants) {
      result.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        unit: variant.unit,
        vatRate:
          variant.vatRate ?? variant.product.unasSnapshot?.vatRate ?? null,
        currentQty:
          onHandByVariant.get(variant.id) ??
          variant.product.unasSnapshot?.reportedStock ??
          new Prisma.Decimal(0),
      });
    }
    return { warehouseId: warehouse.id, variants: result };
  }

  async createSale(params: CreatePosSaleParams): Promise<PosSaleDetail> {
    const now = new Date();
    const created = await this.saleDatabase.$transaction(
      async (transaction) => {
        const order = await transaction.salesOrder.create({
          data: {
            orderNumber: params.orderNumber,
            channel: "POS",
            status: "COMPLETED",
            customerId: params.customerId,
            warehouseId: params.warehouseId,
            soldById: params.actorUserId,
            paymentMethod: params.paymentMethod,
            currency: "HUF",
            totalNet: params.totals.totalNet,
            totalTax: params.totals.totalTax,
            totalGross: params.totals.totalGross,
            orderedAt: now,
            confirmedAt: now,
            completedAt: now,
            lines: {
              create: params.lines.map((line) => ({
                variantId: line.variantId,
                sku: line.sku,
                description: line.productName,
                quantity: line.quantity,
                unit: line.unit,
                unitNet: line.unitNet,
                taxRate: line.taxRate,
                lineGross: line.lineGross,
                syncStatus: line.syncStatus,
                syncError: line.syncError,
              })),
            },
          },
          include: detailInclude,
        });

        const movement = await transaction.stockMovement.create({
          data: {
            movementNumber: generateCode("ELAD"),
            type: "SALE",
            status: "POSTED",
            sourceWarehouseId: params.warehouseId,
            referenceType: "SalesOrder",
            referenceId: order.id,
            performedById: params.actorUserId,
            occurredAt: now,
            postedAt: now,
          },
        });

        for (const line of params.lines) {
          await transaction.stockMovementLine.create({
            data: {
              movementId: movement.id,
              variantId: line.variantId,
              quantity: line.quantity,
              unit: line.unit,
            },
          });
          await setStockItemQuantity(transaction, {
            variantId: line.variantId,
            warehouseId: params.warehouseId,
            onHand: line.resultingQty,
          });
        }

        return order;
      },
    );

    return toPosSaleDetail(created);
  }

  async list(query: PosSaleListQueryDto): Promise<PosSaleListResponse> {
    const where = { channel: "POS" } as const;
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.saleDatabase.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      this.saleDatabase.salesOrder.count({ where }),
    ]);
    return {
      items: items.map(toPosSaleListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<PosSaleDetail | null> {
    const order = await this.saleDatabase.salesOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    return order ? toPosSaleDetail(order) : null;
  }
}
