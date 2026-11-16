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
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<MarkRow>;
    update(args: unknown): Promise<MarkRow>;
    delete(args: unknown): Promise<unknown>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
  domainEvent: { create(args: unknown): Promise<unknown> };
}

/** The reads the checks need; a transaction and the plain database both have them. */
interface MarkChecks {
  product: { findUnique(args: unknown): Promise<ProductRow | null> };
  productDiscontinuation: {
    findUnique(args: unknown): Promise<MarkRow | null>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

export interface ProductDiscontinuationDatabase {
  product: { findUnique(args: unknown): Promise<ProductRow | null> };
  productDiscontinuation: {
    findUnique(args: unknown): Promise<MarkRow | null>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
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
  | "PRODUCT_IS_A_REPLACEMENT"
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
   * THE CHECKS, ONE COPY FOR THE WRITE AND FOR THE DRY RUN. `set` runs them inside its Serializable transaction;
   * `check` (the bulk command's dry run) runs them on plain reads, so a dry run refuses exactly what a write
   * would, for the same database state. Nothing is written here.
   */
  private async validate(
    reads: MarkChecks,
    productId: string,
    replacementProductId: string | null,
    ignoreMarksOf: readonly string[] = [],
  ): Promise<void> {
    const product = await reads.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, isActive: true, webshopSellable: true },
    });
    if (!product) throw new MarkRefused("PRODUCT_NOT_FOUND");
    const replacesOther = await reads.productDiscontinuation.findFirst({
      where: {
        replacementProductId: productId,
        ...(ignoreMarksOf.length > 0
          ? { productId: { notIn: [...ignoreMarksOf] } }
          : {}),
      },
      select: { id: true },
    });
    if (replacesOther) throw new MarkRefused("PRODUCT_IS_A_REPLACEMENT");
    if (replacementProductId === null) return;
    if (replacementProductId === productId)
      throw new MarkRefused("REPLACEMENT_IS_SELF");
    const replacement = await reads.product.findUnique({
      where: { id: replacementProductId },
      select: { id: true, name: true, isActive: true, webshopSellable: true },
    });
    if (!replacement) throw new MarkRefused("REPLACEMENT_NOT_FOUND");
    if (!replacement.isActive || !replacement.webshopSellable)
      throw new MarkRefused("REPLACEMENT_NOT_SELLABLE");
    const replacementMark = await reads.productDiscontinuation.findUnique({
      where: { productId: replacementProductId },
      select: MARK_SELECT,
    });
    if (replacementMark) throw new MarkRefused("REPLACEMENT_ALSO_DISCONTINUED");
  }

  /**
   * The refusal a write would give for this state, or `null`: it would go through. Writes nothing.
   *
   * `ignoreMarksOf` is for the bulk command's dry run (barracuda, #2574 review): the marks of THESE products
   * are treated as already rewritten away by an earlier row of the same file, so a product that only they
   * pointed at is not refused as "a replacement" for it. A write needs no such list, because the earlier
   * row's write has already changed the database.
   */
  async check(
    productId: string,
    replacementProductId: string | null,
    ignoreMarksOf: readonly string[] = [],
  ): Promise<MarkRefusal | null> {
    try {
      await this.validate(
        this.markDatabase,
        productId,
        replacementProductId,
        ignoreMarksOf,
      );
      return null;
    } catch (error) {
      if (error instanceof MarkRefused) return error.refusal;
      throw error;
    }
  }

  /**
   * THE WHOLE CHECK AND THE WRITE ARE ONE SERIALIZABLE TRANSACTION: a replacement that is marked a second
   * later, or a product that is deleted, cannot slip between the check and the write. The checks refuse a
   * replacement that is the product itself, that does not exist, that cannot be bought now (a dead end, as on
   * the "not available" page), or that is itself marked (a chain: the shop follows one hop).
   *
   * THE CHAIN RULE CLOSES FROM BOTH SIDES (barracuda, #2571 review): `set(A, B)` is refused when B is marked,
   * and `set(B, ...)` is refused when B is already the approved replacement of a marked product, so neither
   * order of writes can leave A pointing at a discontinued B. The way out for the person is to pick another
   * replacement for A first. The final redirect list re-checks the replacement with the shop's own
   * publication rule anyway, because a replacement can also stop being sellable after this write.
   */
  async set(
    productId: string,
    replacementProductId: string | null,
    actorUserId: string,
    via?: string,
  ): Promise<ProductDiscontinuation> {
    return this.markDatabase.$transaction(
      async (transaction) => {
        await this.validate(transaction, productId, replacementProductId);
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
          via,
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
      /**
       * WHICH PATH WROTE IT, only when it is not the screen (`"bulk-cli"`): the audit row names the `--actor`
       * the person gave, and the person who ran the command and the person who approved the list can be two
       * different people, which the log could not show (barracuda, #2574 review). Absent for the API.
       */
      via?: string;
    },
  ): Promise<void> {
    const metadata = {
      productId: entry.productId,
      before: entry.before,
      after: entry.after,
      ...(entry.via ? { via: entry.via } : {}),
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
