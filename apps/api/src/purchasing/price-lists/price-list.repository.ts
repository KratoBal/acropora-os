import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { SupplierPriceListFormat } from "@acropora/types";

import type { ExistingMatch, MatchDecision } from "./price-list-matching.js";
import type { ParsedPriceEntry } from "./price-list.types.js";

const CHUNK = 1000;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export interface NewListInput {
  supplierId: string;
  format: SupplierPriceListFormat;
  listDate: Date;
  currency: string;
  sourceFileName: string;
  sourceSha256: string;
  rowCount: number;
  rejectedRowCount: number;
  uploadedById: string | null;
}

/**
 * AZ ÁRLISTÁK ADATBÁZIS-OLDALA (task beszallitoi-arlistak-2). A fájl nem
 * tárolódik, csak a feldolgozott sorok. A termékpárosítás (`SupplierPriceMatch`)
 * a `(supplierId, supplierSku)` kulcson él, nem a listán: egy lista törlése a
 * sorait viszi, a párosításokat megtartja.
 */
@Injectable()
export class PriceListRepository {
  private readonly database = prisma;

  supplier(id: string) {
    return this.database.supplier.findUnique({
      where: { id },
      select: { id: true, name: true, isSupplier: true, isActive: true },
    });
  }

  /** A beszállító már feltöltött ilyen tartalmú fájlt? (A lenyomat beszállítónként egyedi.) */
  duplicate(supplierId: string, sourceSha256: string) {
    return this.database.supplierPriceList.findUnique({
      where: { supplierId_sourceSha256: { supplierId, sourceSha256 } },
      select: {
        id: true,
        listDate: true,
        sourceFileName: true,
        createdAt: true,
      },
    });
  }

  /** A lista és a sorai EGY tranzakcióban: félig mentett lista nincs. */
  async create(
    input: NewListInput,
    entries: readonly ParsedPriceEntry[],
  ): Promise<string> {
    return this.database.$transaction(
      async (transaction) => {
        const list = await transaction.supplierPriceList.create({
          data: input,
          select: { id: true },
        });
        for (const part of chunks(entries))
          await transaction.supplierPriceListEntry.createMany({
            data: part.map((entry) => ({
              listId: list.id,
              supplierSku: entry.supplierSku,
              supplierName: entry.supplierName,
              brand: entry.brand,
              gtin: entry.gtin,
              unitPrice: entry.unitPrice,
              listRetailPrice: entry.listRetailPrice,
              rowNumber: entry.rowNumber,
            })),
          });
        await transaction.auditLog.create({
          data: {
            userId: input.uploadedById,
            action: "supplier-price-list.uploaded",
            entityType: "SupplierPriceList",
            entityId: list.id,
            metadata: {
              supplierId: input.supplierId,
              format: input.format,
              listDate: input.listDate.toISOString().slice(0, 10),
              fileName: input.sourceFileName,
              sha256: input.sourceSha256,
              rowCount: input.rowCount,
              rejectedRowCount: input.rejectedRowCount,
            },
          },
        });
        return list.id;
      },
      { timeout: 60_000 },
    );
  }

  lists(supplierId?: string) {
    return this.database.supplierPriceList.findMany({
      where: supplierId ? { supplierId } : {},
      orderBy: [{ listDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        supplierId: true,
        format: true,
        listDate: true,
        currency: true,
        sourceFileName: true,
        rowCount: true,
        rejectedRowCount: true,
        createdAt: true,
        supplier: { select: { name: true } },
      },
    });
  }

  /** A termékek vonalkódjai a megadott kódokra (a tárolt alakok: EAN-13, UPC-A, EAN-8, GTIN-14). */
  async barcodes(
    codes: readonly string[],
  ): Promise<{ code: string; variantId: string }[]> {
    const found: { code: string; variantId: string }[] = [];
    for (const part of chunks([...new Set(codes)], 5000))
      found.push(
        ...(await this.database.productBarcode.findMany({
          where: { code: { in: part } },
          select: { code: true, variantId: true },
        })),
      );
    return found;
  }

  async existingMatches(
    supplierId: string,
    skus: readonly string[],
  ): Promise<Map<string, ExistingMatch>> {
    const map = new Map<string, ExistingMatch>();
    for (const part of chunks(skus, 5000))
      for (const row of await this.database.supplierPriceMatch.findMany({
        where: { supplierId, supplierSku: { in: part } },
        select: { supplierSku: true, variantId: true, status: true },
      }))
        map.set(row.supplierSku, {
          variantId: row.variantId,
          status: row.status,
        });
    return map;
  }

  /** A `SupplierProduct` ismert kódjai: CSAK olvassuk (a v1 nem ír bele). */
  async knownCodes(
    supplierId: string,
    skus: readonly string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const part of chunks(skus, 5000))
      for (const row of await this.database.supplierProduct.findMany({
        where: { supplierId, supplierSku: { in: part } },
        select: { supplierSku: true, variantId: true },
      }))
        map.set(row.supplierSku, row.variantId);
    return map;
  }

  /**
   * Az új automatikus kötések mentése: csak `createMany`, és `skipDuplicates`.
   * Meglévő sort SOHA nem ír át: egy közben létrejött, jóváhagyott vagy
   * elutasított sor érintetlen marad (acrobot 35592).
   */
  async saveAutoMatches(
    supplierId: string,
    decisions: readonly MatchDecision[],
  ): Promise<void> {
    const fresh = decisions.flatMap((decision) =>
      decision.kind === "NEW_AUTO" ? [decision] : [],
    );
    await this.database.$transaction(
      async (transaction) => {
        for (const part of chunks(fresh))
          await transaction.supplierPriceMatch.createMany({
            data: part.map((decision) => ({
              supplierId,
              supplierSku: decision.supplierSku,
              variantId: decision.variantId,
              method: decision.method,
              status: "AUTO" as const,
            })),
            skipDuplicates: true,
          });
      },
      { timeout: 60_000 },
    );
  }

  /** A lista törlése (a sorai a kaszkáddal mennek, a párosítások maradnak) és az audit sora, egy tranzakcióban. */
  async remove(
    id: string,
    userId: string,
  ): Promise<{ rowCount: number; sourceFileName: string } | null> {
    return this.database.$transaction(async (transaction) => {
      const list = await transaction.supplierPriceList.findUnique({
        where: { id },
        select: {
          id: true,
          supplierId: true,
          format: true,
          listDate: true,
          sourceFileName: true,
          sourceSha256: true,
          rowCount: true,
        },
      });
      if (!list) return null;
      await transaction.supplierPriceList.delete({ where: { id } });
      await transaction.auditLog.create({
        data: {
          userId,
          action: "supplier-price-list.deleted",
          entityType: "SupplierPriceList",
          entityId: id,
          metadata: {
            supplierId: list.supplierId,
            format: list.format,
            listDate: list.listDate.toISOString().slice(0, 10),
            fileName: list.sourceFileName,
            sha256: list.sourceSha256,
            rowCount: list.rowCount,
          },
        },
      });
      return { rowCount: list.rowCount, sourceFileName: list.sourceFileName };
    });
  }
}
