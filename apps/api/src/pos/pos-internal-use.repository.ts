import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  PosInternalUseDetail,
  PosInternalUseListItem,
  PosInternalUseListResponse,
  PosSaleStockWarning,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import { postInventoryMovement } from "../common/inventory-movement-writer.js";
import { retryOnTakenCode } from "../common/unique-code.util.js";
import {
  snapshotCost,
  type CostSnapshotDatabase,
} from "../quotes/quote-cost-snapshot.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import type { PosSaleStockComponent } from "./pos-sale.repository.js";

/** The `referenceType` of the stock movement a record posts; the movement points back to the record with it. */
export const POS_INTERNAL_USE_REFERENCE_TYPE = "PosInternalUse";

export interface CreatePosInternalUseLine {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: Prisma.Decimal;
  /** Net HUF purchase price of one unit at recording time; `null` when unknown. */
  unitCost: Prisma.Decimal | null;
  stockComponents: PosSaleStockComponent[];
}

export interface CreatePosInternalUseParams {
  number: string;
  warehouseId: string;
  actorUserId: string;
  note: string;
  totalCost: Prisma.Decimal | null;
  lines: CreatePosInternalUseLine[];
}

const detailInclude = {
  performedBy: { select: { displayName: true } },
  lines: { orderBy: { id: "asc" } },
} as const;

type InternalUseWithLines = Prisma.PosInternalUseGetPayload<{
  include: typeof detailInclude;
}>;

const money = (value: Prisma.Decimal | null) =>
  value === null ? null : value.toFixed(2);

export function toPosInternalUseDetail(
  row: InternalUseWithLines,
): PosInternalUseDetail {
  return {
    id: row.id,
    number: row.number,
    note: row.note,
    performedByName: row.performedBy?.displayName ?? null,
    occurredAt: row.occurredAt.toISOString(),
    totalCost: money(row.totalCost),
    lines: row.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitCost: money(line.unitCost),
      lineCost: line.unitCost
        ? money(line.unitCost.times(line.quantity))
        : null,
    })),
  };
}

/**
 * THE POS "BELSŐ FELHASZNÁLÁS" (card ec51e614): the record, its lines and the stock movement in ONE transaction, the same way
 * a POS sale books its stock (`pos-sale.repository.ts`): `postInventoryMovement` decreases the stock under its lock and queues
 * the UNAS outbox row, so the shop's stock follows as it does after a sale. Nothing here touches `SalesOrder`, so no revenue
 * summary (POS summary, cash desk, dashboards) can ever count it.
 */
@Injectable()
export class PosInternalUseRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /** The net HUF purchase price of each variant, by the quote costing's rule (`snapshotCost`); `null` where unknown. */
  async unitCosts(
    variantIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal | null>> {
    const costs = new Map<string, Prisma.Decimal | null>();
    for (const variantId of new Set(variantIds)) {
      const snapshot = await snapshotCost(
        this.database as unknown as CostSnapshotDatabase,
        variantId,
      );
      costs.set(variantId, snapshot.unitCost);
    }
    return costs;
  }

  async create(params: CreatePosInternalUseParams): Promise<{
    detail: PosInternalUseDetail;
    stockWarnings: PosSaleStockWarning[];
  }> {
    const now = new Date();
    return retryOnTakenCode({ field: "movementNumber" }, () =>
      this.database.$transaction(async (transaction) => {
        const stockWarnings: PosSaleStockWarning[] = [];
        const record = await transaction.posInternalUse.create({
          data: {
            number: params.number,
            note: params.note,
            warehouseId: params.warehouseId,
            performedById: params.actorUserId,
            occurredAt: now,
            totalCost: params.totalCost,
            lines: {
              create: params.lines.map((line) => ({
                variantId: line.variantId,
                sku: line.sku,
                productName: line.productName,
                quantity: line.quantity,
                unit: line.unit,
                unitCost: line.unitCost,
              })),
            },
          },
          include: detailInclude,
        });

        // the stock components, summed per variant: a package product decreases its components, as a sale does
        const byVariant = new Map<
          string,
          {
            variantId: string;
            sku: string;
            productName: string;
            quantityDelta: Prisma.Decimal;
            unit: string;
            syncToUnas: boolean;
          }
        >();
        for (const line of params.lines)
          for (const component of line.stockComponents) {
            const delta = line.quantity
              .times(component.quantityPerSale)
              .negated();
            const existing = byVariant.get(component.variantId);
            if (existing)
              existing.quantityDelta = existing.quantityDelta.plus(delta);
            else
              byVariant.set(component.variantId, {
                variantId: component.variantId,
                sku: component.sku,
                productName: component.productName,
                quantityDelta: delta,
                unit: component.unit,
                syncToUnas: component.syncToUnas,
              });
          }

        const posted = await postInventoryMovement(transaction, {
          idempotencyKey: `POS_INTERNAL_USE:${params.number}`,
          movementNumber: generateCode("BFHM"),
          type: "INTERNAL_USE",
          warehouseId: params.warehouseId,
          referenceType: POS_INTERNAL_USE_REFERENCE_TYPE,
          referenceId: record.id,
          performedById: params.actorUserId,
          occurredAt: now,
          note: params.number,
          sourceProcess: "POS_INTERNAL_USE",
          lines: [...byVariant.values()].map((line) => ({
            variantId: line.variantId,
            sku: line.sku,
            quantityDelta: line.quantityDelta,
            unit: line.unit,
            syncToUnas: line.syncToUnas,
          })),
        });
        for (const line of posted.lines)
          if (line.wentNegative)
            stockWarnings.push({
              sku: line.sku,
              productName:
                byVariant.get(line.variantId)?.productName ?? line.sku,
              resultingQty: line.resultingOnHand.toString(),
            });

        return { detail: toPosInternalUseDetail(record), stockWarnings };
      }),
    );
  }

  async list(query: PosSaleListQueryDto): Promise<PosInternalUseListResponse> {
    const where: Prisma.PosInternalUseWhereInput =
      query.createdFrom || query.createdTo
        ? {
            occurredAt: {
              ...(query.createdFrom
                ? { gte: new Date(query.createdFrom) }
                : {}),
              ...(query.createdTo ? { lt: new Date(query.createdTo) } : {}),
            },
          }
        : {};
    const [rows, totalItems] = await Promise.all([
      this.database.posInternalUse.findMany({
        where,
        include: {
          performedBy: { select: { displayName: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.posInternalUse.count({ where }),
    ]);
    return {
      items: rows.map((row): PosInternalUseListItem => ({
        id: row.id,
        number: row.number,
        note: row.note,
        performedByName: row.performedBy?.displayName ?? null,
        occurredAt: row.occurredAt.toISOString(),
        totalCost: money(row.totalCost),
        lineCount: row._count.lines,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<PosInternalUseDetail | null> {
    const row = await this.database.posInternalUse.findUnique({
      where: { id },
      include: detailInclude,
    });
    return row ? toPosInternalUseDetail(row) : null;
  }
}
