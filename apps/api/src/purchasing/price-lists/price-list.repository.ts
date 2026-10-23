import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { SupplierPriceListFormat } from "@acropora/types";

import { loadVariantListPrices } from "../../quotes/variant-list-price.js";

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
/** A `coverage` lekérdezés egy sora (a számlálók egész számok). */
export interface CoverageRaw {
  listId: string;
  rows: number;
  eanAuto: number;
  eanApproved: number;
  codeAuto: number;
  codeApproved: number;
  nameAuto: number;
  nameApproved: number;
  rejected: number;
  unmatchedWithBarcode: number;
  unmatchedWithoutBarcode: number;
  unmatchedBarcodeKnownToUs: number;
}
export type CoverageRow = CoverageRaw;

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

  /** A mai nettó eladási ár forintban, a változat áfakulcsával; `null`: nincs ilyen változat. */
  async sellingPrice(variantId: string, now: Date) {
    return (
      (await loadVariantListPrices(this.database, [variantId], now)).get(
        variantId,
      ) ?? null
    );
  }

  /** Az ember vagy az automatika által kötött (nem elutasított) cikkszámok a változatra. */
  matchesForVariant(variantId: string) {
    return this.database.supplierPriceMatch.findMany({
      where: { variantId, status: { in: ["AUTO", "APPROVED"] } },
      select: {
        supplierId: true,
        supplierSku: true,
        method: true,
        status: true,
        supplier: { select: { name: true } },
      },
    });
  }

  /**
   * A cikkszám legfrissebb sora a beszállító listái közül (lista-dátum, majd a
   * feltöltés ideje szerint). Egy cikkszám korábbi listái nem számítanak.
   */
  async latestEntries(
    pairs: readonly { supplierId: string; supplierSku: string }[],
  ) {
    const latest = new Map<
      string,
      {
        supplierName: string | null;
        unitPrice: string;
        listRetailPrice: string | null;
        listDate: Date;
        currency: string;
      }
    >();
    const bySupplier = new Map<string, string[]>();
    for (const pair of pairs)
      bySupplier.set(pair.supplierId, [
        ...(bySupplier.get(pair.supplierId) ?? []),
        pair.supplierSku,
      ]);
    for (const [supplierId, skus] of bySupplier) {
      const rows = await this.database.supplierPriceListEntry.findMany({
        where: { supplierSku: { in: skus }, list: { supplierId } },
        orderBy: [
          { list: { listDate: "desc" } },
          { list: { createdAt: "desc" } },
        ],
        select: {
          supplierSku: true,
          supplierName: true,
          unitPrice: true,
          listRetailPrice: true,
          list: { select: { listDate: true, currency: true } },
        },
      });
      for (const row of rows) {
        const key = `${supplierId}\u0000${row.supplierSku}`;
        if (latest.has(key)) continue;
        latest.set(key, {
          supplierName: row.supplierName,
          unitPrice: row.unitPrice.toString(),
          listRetailPrice: row.listRetailPrice?.toString() ?? null,
          listDate: row.list.listDate,
          currency: row.list.currency,
        });
      }
    }
    return latest;
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

  /**
   * A LISTÁK PÁROSÍTÁSI LEFEDETTSÉGE (task arlista-parositas-meres): listánként egy
   * összesítő sor, az adatbázisban számolva (egy lekérdezés, a sorok nem jönnek
   * át). A lista sorához a (beszállító, cikkszám) kötés tartozik, a csoportok nem
   * átfedők: párosított (módszer és állapot szerint), elutasított, párosítatlan.
   * A mi vonalkódjainkat egyszer normalizáljuk (csak számjegyek, 14 jegyre
   * töltve; csak a GS1 hosszúságúak, 8 és 14 jegy között, mint a `normalizeGtin`;
   * és csak az, amelyik EGY változaton áll: a több változaton álló vonalkód
   * ütközés, nem hiba), és a párosítatlan, vonalkódos sorok közül azt számoljuk,
   * amelyiknek a kódja benne van. Nem nulla: vagy a cikkszám ellentmond a
   * vonalkódnak, vagy a vonalkód nálunk másképp tárolt: ellenőrizendő.
   */
  async coverage(
    listIds: readonly string[],
  ): Promise<Map<string, CoverageRow>> {
    if (listIds.length === 0) return new Map();
    const rows = await this.database.$queryRaw<CoverageRaw[]>`
      WITH ours AS (
        SELECT lpad(regexp_replace(code, '[^0-9]', '', 'g'), 14, '0') AS gtin
        FROM "ProductBarcode"
        WHERE length(regexp_replace(code, '[^0-9]', '', 'g')) BETWEEN 8 AND 14
        GROUP BY 1
        HAVING count(DISTINCT "variantId") = 1
      )
      SELECT e."listId" AS "listId",
        count(*)::int AS "rows",
        count(*) FILTER (WHERE m.method = 'EAN' AND m.status = 'AUTO')::int AS "eanAuto",
        count(*) FILTER (WHERE m.method = 'EAN' AND m.status = 'APPROVED')::int AS "eanApproved",
        count(*) FILTER (WHERE m.method = 'SUPPLIER_CODE' AND m.status = 'AUTO')::int AS "codeAuto",
        count(*) FILTER (WHERE m.method = 'SUPPLIER_CODE' AND m.status = 'APPROVED')::int AS "codeApproved",
        count(*) FILTER (WHERE m.method = 'NAME' AND m.status = 'AUTO')::int AS "nameAuto",
        count(*) FILTER (WHERE m.method = 'NAME' AND m.status = 'APPROVED')::int AS "nameApproved",
        count(*) FILTER (WHERE m.status = 'REJECTED')::int AS "rejected",
        count(*) FILTER (WHERE m.id IS NULL AND e.gtin IS NOT NULL)::int AS "unmatchedWithBarcode",
        count(*) FILTER (WHERE m.id IS NULL AND e.gtin IS NULL)::int AS "unmatchedWithoutBarcode",
        count(*) FILTER (WHERE m.id IS NULL AND e.gtin IN (SELECT gtin FROM ours))::int AS "unmatchedBarcodeKnownToUs"
      FROM "SupplierPriceListEntry" e
      JOIN "SupplierPriceList" l ON l.id = e."listId"
      LEFT JOIN "SupplierPriceMatch" m
        ON m."supplierId" = l."supplierId" AND m."supplierSku" = e."supplierSku"
      WHERE e."listId" = ANY(${[...listIds]})
      GROUP BY e."listId"`;
    return new Map(rows.map((row) => [row.listId, row]));
  }

  /** A mi aktív változataink és a vonalkód nélküliek száma. */
  async variantBarcodeCounts(): Promise<{
    active: number;
    withoutBarcode: number;
  }> {
    const [active, withoutBarcode] = await Promise.all([
      this.database.productVariant.count({ where: { isActive: true } }),
      this.database.productVariant.count({
        where: { isActive: true, barcodes: { none: {} } },
      }),
    ]);
    return { active, withoutBarcode };
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
