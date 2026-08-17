import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { ProductBarcodeSummary } from "@acropora/types";

/** Primary first, then by code - the same order the product detail uses. */
const ORDER = [
  { isPrimary: "desc" },
  { code: "asc" },
] satisfies Prisma.ProductBarcodeOrderByWithRelationInput[];

export interface BarcodeOwner {
  variantId: string;
  sku: string;
}

@Injectable()
export class ProductBarcodeRepository extends Repository {
  constructor() {
    super(prisma);
  }

  variantExists(variantId: string) {
    return this.database.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
  }

  list(variantId: string): Promise<ProductBarcodeSummary[]> {
    return this.database.productBarcode.findMany({
      where: { variantId },
      orderBy: ORDER,
      select: { id: true, code: true, isPrimary: true },
    });
  }

  /**
   * Which variant already owns this code, if any. Codes are unique across the
   * whole catalogue, so this answers "can I add it" and "who has it" at once -
   * and the caller can name the SKU in the error instead of a bare conflict.
   */
  async owner(code: string): Promise<BarcodeOwner | null> {
    const existing = await this.database.productBarcode.findUnique({
      where: { code },
      select: { variantId: true, variant: { select: { sku: true } } },
    });
    return existing
      ? { variantId: existing.variantId, sku: existing.variant.sku }
      : null;
  }

  /**
   * Adds a code and keeps "at most one primary per variant" true.
   *
   * The rule is enforced here rather than by a constraint because Prisma
   * cannot express a partial unique index (`WHERE isPrimary`), and a plain
   * unique index on [variantId, isPrimary] would also forbid a second
   * *non*-primary barcode, which is exactly what we want to allow. Doing it in
   * one serializable transaction keeps two concurrent writers from both
   * claiming primary.
   *
   * A variant's first barcode becomes primary on its own: a lone barcode that
   * is not the primary one would be a state nobody intends.
   */
  add(
    variantId: string,
    code: string,
    isPrimary: boolean | undefined,
  ): Promise<ProductBarcodeSummary> {
    return this.database.$transaction(
      async (tx) => {
        const count = await tx.productBarcode.count({ where: { variantId } });
        const primary = isPrimary ?? count === 0;

        if (primary)
          await tx.productBarcode.updateMany({
            where: { variantId, isPrimary: true },
            data: { isPrimary: false },
          });

        return tx.productBarcode.create({
          data: { variantId, code, isPrimary: primary },
          select: { id: true, code: true, isPrimary: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  find(variantId: string, barcodeId: string) {
    return this.database.productBarcode.findFirst({
      where: { id: barcodeId, variantId },
      select: { id: true, code: true, isPrimary: true },
    });
  }

  setPrimary(
    variantId: string,
    barcodeId: string,
  ): Promise<ProductBarcodeSummary[]> {
    return this.database.$transaction(
      async (tx) => {
        await tx.productBarcode.updateMany({
          where: { variantId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.productBarcode.update({
          where: { id: barcodeId },
          data: { isPrimary: true },
        });
        return tx.productBarcode.findMany({
          where: { variantId },
          orderBy: ORDER,
          select: { id: true, code: true, isPrimary: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Removing the primary promotes the next remaining code, so a variant that
   * still has barcodes always has exactly one primary.
   */
  remove(
    variantId: string,
    barcodeId: string,
  ): Promise<ProductBarcodeSummary[]> {
    return this.database.$transaction(
      async (tx) => {
        const removed = await tx.productBarcode.delete({
          where: { id: barcodeId },
          select: { isPrimary: true },
        });
        if (removed.isPrimary) {
          const next = await tx.productBarcode.findFirst({
            where: { variantId },
            orderBy: [{ code: "asc" }],
            select: { id: true },
          });
          if (next)
            await tx.productBarcode.update({
              where: { id: next.id },
              data: { isPrimary: true },
            });
        }
        return tx.productBarcode.findMany({
          where: { variantId },
          orderBy: ORDER,
          select: { id: true, code: true, isPrimary: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
