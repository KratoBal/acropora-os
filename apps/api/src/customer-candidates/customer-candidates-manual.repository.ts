import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import {
  ManualListChangedError,
  sameManualContent,
  type ManualPlanCurrent,
} from "./customer-candidates-manual.rules.js";

/** The audit row written in the SAME transaction as the replacement (who, how, and what was about to change). */
export interface ManualListAudit {
  userId: string | null;
  metadata: Record<string, unknown>;
}

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

const toCurrent = (row: {
  productId: string;
  sku: string;
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  referenceUrl: string;
  basis: "MAKER" | "SHOP_TEXT";
  sideEffects: string[];
  sideEffectsStatus: "FILLED" | "PENDING";
  note: string | null;
}): ManualPlanCurrent => ({
  productId: row.productId,
  sku: row.sku,
  parameter: row.parameterCode,
  direction: row.direction,
  referenceUrl: row.referenceUrl,
  basis: row.basis,
  sideEffects: row.sideEffects,
  sideEffectsStatus: row.sideEffectsStatus,
  note: row.note,
});

/** What the import needs from the database (an interface, so the command's logic is tested without one). */
export interface ManualListStore {
  /** SKU -> the products it belongs to (more than one product for one SKU cannot happen: the SKU is unique, but the answer is a list so a doubt is visible). */
  resolve(skus: readonly string[]): Promise<Map<string, ResolvedSku[]>>;
  current(): Promise<ManualPlanCurrent[]>;
  /**
   * `stillCurrent` is asked UNDER THE LOCK with the rows held right then; false throws `ManualListChangedError` and writes nothing.
   */
  replace(
    rows: readonly ManualRowToStore[],
    approvedBy: string,
    approvedAt: Date,
    audit?: ManualListAudit,
    stillCurrent?: (current: ManualPlanCurrent[]) => boolean,
  ): Promise<{ stored: number; removed: number }>;
}

@Injectable()
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
    return rows.map(toCurrent);
  }

  /**
   * A TEST SEAM, a no-op in the app: it runs inside the replacement's transaction, after the lock and the check, before the writes.
   * The integration spec holds a first apply here to force a second one into the window the lock must close.
   */
  afterCheckProbe: () => Promise<void> = async () => {};

  /**
   * THE WHOLE LIST IN ONE TRANSACTION: each row is an upsert on its product and move, and what is not in the file goes. A failure changes nothing.
   *
   * ONE WRITER AT A TIME, AND THE CHECK UNDER THE LOCK (murena's open point on #2428): the transaction first takes a fixed advisory lock,
   * then reads the rows and asks `stillCurrent` about THEM. Two applies made from the same dry run used to both pass the fingerprint
   * (each checked before the other wrote) and the later commit silently replaced the earlier list. Now the second waits for the first,
   * reads what it stored, and is refused.
   */
  async replace(
    rows: readonly ManualRowToStore[],
    approvedBy: string,
    approvedAt: Date,
    audit?: ManualListAudit,
    stillCurrent?: (current: ManualPlanCurrent[]) => boolean,
  ): Promise<{ stored: number; removed: number }> {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('customer-candidates-manual-list'))`;
      const ids: string[] = [];
      const held = await tx.customerCandidateManualEntry.findMany();
      if (stillCurrent && !stillCurrent(held.map(toCurrent)))
        throw new ManualListChangedError();
      await this.afterCheckProbe();
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
              sku: existing.sku,
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
      if (audit)
        await tx.auditLog.create({
          data: {
            userId: audit.userId,
            action: "customer-candidates.manual-list.applied",
            entityType: "CustomerCandidateManualEntry",
            metadata: {
              ...audit.metadata,
              stored: ids.length,
              removed: removed.count,
            } as Prisma.InputJsonObject,
          },
        });
      return { stored: ids.length, removed: removed.count };
    });
  }
}
