import { prisma } from "@acropora/database";

import {
  sameManualContent,
  type ManualPlanCurrent,
} from "./customer-candidates-manual.rules.js";

export interface ResolvedSku {
  productId: string;
  productName: string;
  active: boolean;
}

export interface ManualRowToStore {
  productId: string;
  sku: string;
  parameter: string;
  direction: "EMEL" | "CSOKKENT";
  referenceUrl: string;
  basis: "MAKER" | "SHOP_TEXT";
  sideEffects: string[];
  sideEffectsStatus: "FILLED" | "PENDING";
  note: string | null;
}

/** What the import needs from the database (an interface, so the command's logic is tested without one). */
export interface ManualListStore {
  /** SKU -> the products it belongs to (more than one product for one SKU cannot happen: the SKU is unique, but the answer is a list so a doubt is visible). */
  resolve(skus: readonly string[]): Promise<Map<string, ResolvedSku[]>>;
  current(): Promise<ManualPlanCurrent[]>;
  replace(
    rows: readonly ManualRowToStore[],
    approvedBy: string,
    approvedAt: Date,
  ): Promise<{ stored: number; removed: number }>;
}

export class PrismaManualListStore implements ManualListStore {
  private readonly database = prisma;

  async resolve(skus: readonly string[]): Promise<Map<string, ResolvedSku[]>> {
    const variants = await this.database.productVariant.findMany({
      where: { sku: { in: [...skus] } },
      select: {
        sku: true,
        productId: true,
        product: { select: { name: true, isActive: true, archivedAt: true } },
      },
    });
    const result = new Map<string, ResolvedSku[]>();
    for (const variant of variants) {
      const list = result.get(variant.sku) ?? [];
      list.push({
        productId: variant.productId,
        productName: variant.product.name,
        active: variant.product.isActive && variant.product.archivedAt === null,
      });
      result.set(variant.sku, list);
    }
    return result;
  }

  async current(): Promise<ManualPlanCurrent[]> {
    const rows = await this.database.customerCandidateManualEntry.findMany();
    return rows.map((row) => ({
      productId: row.productId,
      parameter: row.parameterCode,
      direction: row.direction,
      referenceUrl: row.referenceUrl,
      basis: row.basis,
      sideEffects: row.sideEffects,
      sideEffectsStatus: row.sideEffectsStatus,
      note: row.note,
    }));
  }

  /** THE WHOLE LIST IN ONE TRANSACTION: each row is an upsert on its product and move, and what is not in the file goes. A failure changes nothing. */
  async replace(
    rows: readonly ManualRowToStore[],
    approvedBy: string,
    approvedAt: Date,
  ): Promise<{ stored: number; removed: number }> {
    return this.database.$transaction(async (tx) => {
      const ids: string[] = [];
      const held = await tx.customerCandidateManualEntry.findMany();
      const heldByMove = new Map(
        held.map((entry) => [
          `${entry.productId}|${entry.parameterCode}|${entry.direction}`,
          entry,
        ]),
      );
      for (const row of rows) {
        // An unchanged row keeps its ORIGINAL approver and time: only what this run changes is approved by this run.
        const existing = heldByMove.get(
          `${row.productId}|${row.parameter}|${row.direction}`,
        );
        if (
          existing &&
          sameManualContent(
            {
              productId: existing.productId,
              parameter: existing.parameterCode,
              direction: existing.direction,
              referenceUrl: existing.referenceUrl,
              basis: existing.basis,
              sideEffects: existing.sideEffects,
              sideEffectsStatus: existing.sideEffectsStatus,
              note: existing.note,
            },
            row,
          )
        ) {
          ids.push(existing.id);
          continue;
        }
        const data = {
          sku: row.sku,
          referenceUrl: row.referenceUrl,
          basis: row.basis,
          sideEffects: row.sideEffects,
          sideEffectsStatus: row.sideEffectsStatus,
          note: row.note,
          approvedBy,
          approvedAt,
        };
        const stored = await tx.customerCandidateManualEntry.upsert({
          where: {
            productId_parameterCode_direction: {
              productId: row.productId,
              parameterCode: row.parameter,
              direction: row.direction,
            },
          },
          create: {
            productId: row.productId,
            parameterCode: row.parameter,
            direction: row.direction,
            ...data,
          },
          update: data,
        });
        ids.push(stored.id);
      }
      const removed = await tx.customerCandidateManualEntry.deleteMany({
        where: { id: { notIn: ids } },
      });
      return { stored: ids.length, removed: removed.count };
    });
  }
}
