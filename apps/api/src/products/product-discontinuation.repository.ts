import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { ProductDiscontinuation } from "@acropora/types";

interface MarkRow {
  id: string;
  productId: string;
  replacementProductId: string | null;
  updatedAt: Date;
  replacementProduct: { id: string; name: string } | null;
}

interface ProductRow {
  id: string;
  name: string;
  isActive: boolean;
  webshopSellable: boolean;
}

interface MarkTransaction {
  product: { findUnique(args: unknown): Promise<ProductRow | null> };
  productDiscontinuation: {
    findUnique(args: unknown): Promise<MarkRow | null>;
    create(args: unknown): Promise<MarkRow>;
    update(args: unknown): Promise<MarkRow>;
    delete(args: unknown): Promise<unknown>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
  domainEvent: { create(args: unknown): Promise<unknown> };
}

export interface ProductDiscontinuationDatabase {
  product: { findUnique(args: unknown): Promise<{ id: string } | null> };
  productDiscontinuation: {
    findUnique(args: unknown): Promise<MarkRow | null>;
  };
  $transaction<T>(
    operation: (transaction: MarkTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export const PRODUCT_DISCONTINUATION_DATABASE = Symbol(
  "PRODUCT_DISCONTINUATION_DATABASE",
);

/** Why a mark cannot be written. The service turns each into a 400/404 with a Hungarian message. */
export type MarkRefusal =
  | "PRODUCT_NOT_FOUND"
  | "REPLACEMENT_IS_SELF"
  | "REPLACEMENT_NOT_FOUND"
  | "REPLACEMENT_NOT_SELLABLE"
  | "REPLACEMENT_ALSO_DISCONTINUED"
  | "MARK_NOT_FOUND";

export class MarkRefused extends Error {
  constructor(readonly refusal: MarkRefusal) {
    super(refusal);
  }
}

const MARK_SELECT = {
  id: true,
  productId: true,
  replacementProductId: true,
  updatedAt: true,
  replacementProduct: { select: { id: true, name: true } },
} as const;

function toDetail(row: MarkRow): ProductDiscontinuation {
  return {
    productId: row.productId,
    replacement: row.replacementProduct
      ? { id: row.replacementProduct.id, name: row.replacementProduct.name }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProductDiscontinuationRepository extends Repository {
  private readonly markDatabase: ProductDiscontinuationDatabase;

  constructor(
    @Optional()
    @Inject(PRODUCT_DISCONTINUATION_DATABASE)
    database?: ProductDiscontinuationDatabase,
  ) {
    super(prisma);
    this.markDatabase =
      database ?? (prisma as unknown as ProductDiscontinuationDatabase);
  }

  async productExists(productId: string): Promise<boolean> {
    return Boolean(
      await this.markDatabase.product.findUnique({
        where: { id: productId },
        select: { id: true },
      }),
    );
  }

  /** `null` is a product nobody marked, which is the normal state. */
  async find(productId: string): Promise<ProductDiscontinuation | null> {
    const row = await this.markDatabase.productDiscontinuation.findUnique({
      where: { productId },
      select: MARK_SELECT,
    });
    return row ? toDetail(row) : null;
  }

  /**
   * THE WHOLE CHECK AND THE WRITE ARE ONE SERIALIZABLE TRANSACTION: a replacement that is marked a second
   * later, or a product that is deleted, cannot slip between the check and the write. The checks refuse a
   * replacement that is the product itself, that does not exist, that cannot be bought now (a dead end, as on
   * the "not available" page), or that is itself marked (a chain: the shop follows one hop). The final
   * redirect list re-checks the replacement with the shop's own publication rule, because it can stop being
   * sellable after this write.
   */
  async set(
    productId: string,
    replacementProductId: string | null,
    actorUserId: string,
  ): Promise<ProductDiscontinuation> {
    return this.markDatabase.$transaction(
      async (transaction) => {
        const product = await transaction.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            name: true,
            isActive: true,
            webshopSellable: true,
          },
        });
        if (!product) throw new MarkRefused("PRODUCT_NOT_FOUND");
        if (replacementProductId !== null) {
          if (replacementProductId === productId)
            throw new MarkRefused("REPLACEMENT_IS_SELF");
          const replacement = await transaction.product.findUnique({
            where: { id: replacementProductId },
            select: {
              id: true,
              name: true,
              isActive: true,
              webshopSellable: true,
            },
          });
          if (!replacement) throw new MarkRefused("REPLACEMENT_NOT_FOUND");
          if (!replacement.isActive || !replacement.webshopSellable)
            throw new MarkRefused("REPLACEMENT_NOT_SELLABLE");
          const replacementMark =
            await transaction.productDiscontinuation.findUnique({
              where: { productId: replacementProductId },
              select: MARK_SELECT,
            });
          if (replacementMark)
            throw new MarkRefused("REPLACEMENT_ALSO_DISCONTINUED");
        }
        const existing = await transaction.productDiscontinuation.findUnique({
          where: { productId },
          select: MARK_SELECT,
        });
        const row = existing
          ? await transaction.productDiscontinuation.update({
              where: { productId },
              data: { replacementProductId },
              select: MARK_SELECT,
            })
          : await transaction.productDiscontinuation.create({
              data: { productId, replacementProductId },
              select: MARK_SELECT,
            });
        await this.record(transaction, {
          action: existing
            ? "product_discontinuation.updated"
            : "product_discontinuation.created",
          rowId: row.id,
          productId,
          actorUserId,
          before: existing
            ? { replacementProductId: existing.replacementProductId }
            : null,
          after: { replacementProductId: row.replacementProductId },
        });
        return toDetail(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Un-marking: the row goes away. A product with no mark is a 404, not a silent success. */
  async remove(productId: string, actorUserId: string): Promise<void> {
    await this.markDatabase.$transaction(
      async (transaction) => {
        const existing = await transaction.productDiscontinuation.findUnique({
          where: { productId },
          select: MARK_SELECT,
        });
        if (!existing) throw new MarkRefused("MARK_NOT_FOUND");
        await transaction.productDiscontinuation.delete({
          where: { productId },
        });
        await this.record(transaction, {
          action: "product_discontinuation.removed",
          rowId: existing.id,
          productId,
          actorUserId,
          before: { replacementProductId: existing.replacementProductId },
          after: null,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** The audit trail carries before and after, like the other manual product marks. */
  private async record(
    transaction: MarkTransaction,
    entry: {
      action: string;
      rowId: string;
      productId: string;
      actorUserId: string;
      before: Prisma.JsonObject | null;
      after: Prisma.JsonObject | null;
    },
  ): Promise<void> {
    const metadata = {
      productId: entry.productId,
      before: entry.before,
      after: entry.after,
    } satisfies Prisma.JsonObject;
    await transaction.auditLog.create({
      data: {
        userId: entry.actorUserId,
        action: entry.action,
        entityType: "ProductDiscontinuation",
        entityId: entry.rowId,
        metadata,
      },
    });
    await transaction.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: entry.action,
        aggregateType: "Product",
        aggregateId: entry.productId,
        actorUserId: entry.actorUserId,
        payload: metadata,
        occurredAt: new Date(),
      },
    });
  }
}
