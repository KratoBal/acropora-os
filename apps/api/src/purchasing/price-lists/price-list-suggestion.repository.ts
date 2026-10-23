import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { NameCandidate, NameSuggestion } from "./name-suggestions.js";

const CHUNK = 5000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** A név alapú javaslatok adatbázis-oldala (task arlista-nev-javaslat). */
@Injectable()
export class PriceListSuggestionRepository {
  private readonly database = prisma;

  list(listId: string) {
    return this.database.supplierPriceList.findUnique({
      where: { id: listId },
      select: { id: true, supplierId: true },
    });
  }

  /** A lista azon sorai, amelyek cikkszámához NINCS kötés (még az elutasított sem). */
  async unmatchedEntries(listId: string, supplierId: string) {
    const entries = await this.database.supplierPriceListEntry.findMany({
      where: { listId },
      select: { supplierSku: true, supplierName: true, brand: true },
    });
    const matched = new Set<string>();
    for (const part of chunks(
      entries.map((entry) => entry.supplierSku),
      CHUNK,
    ))
      for (const row of await this.database.supplierPriceMatch.findMany({
        where: { supplierId, supplierSku: { in: part } },
        select: { supplierSku: true },
      }))
        matched.add(row.supplierSku);
    return entries.filter((entry) => !matched.has(entry.supplierSku));
  }

  /** A mi aktív változataink a névkereséshez: terméknév (és változatnév), márka. */
  async candidates(): Promise<NameCandidate[]> {
    const variants = await this.database.productVariant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        product: { select: { name: true, brand: { select: { name: true } } } },
      },
    });
    return variants.map((variant) => ({
      variantId: variant.id,
      name:
        variant.name && variant.name !== variant.product.name
          ? `${variant.product.name} ${variant.name}`
          : variant.product.name,
      brand: variant.product.brand?.name ?? null,
    }));
  }

  /** Beszúrja a javaslatokat; ami már áll (akár elutasítva), érintetlen marad. */
  async saveSuggestions(
    supplierId: string,
    suggestions: readonly NameSuggestion[],
  ): Promise<number> {
    let stored = 0;
    for (const part of chunks(suggestions, 2000))
      stored += (
        await this.database.supplierPriceSuggestion.createMany({
          data: part.map((suggestion) => ({
            supplierId,
            supplierSku: suggestion.supplierSku,
            variantId: suggestion.variantId,
            score: suggestion.score,
            basis: suggestion.basis,
          })),
          skipDuplicates: true,
        })
      ).count;
    return stored;
  }

  /** A függő javaslatok azonosítói: a cikkszámnak még nincs kötése. Egy lapnyi, és az összes száma. */
  async pendingIds(
    supplierId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ ids: string[]; total: number }> {
    const supplier = supplierId ?? null;
    const [rows, count] = await Promise.all([
      this.database.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM "SupplierPriceSuggestion" s
        WHERE s.status = 'PENDING'
          AND (${supplier}::text IS NULL OR s."supplierId" = ${supplier})
          AND NOT EXISTS (
            SELECT 1 FROM "SupplierPriceMatch" m
            WHERE m."supplierId" = s."supplierId" AND m."supplierSku" = s."supplierSku")
        ORDER BY s."supplierId", s."supplierSku", s.score DESC, s.id
        LIMIT ${limit} OFFSET ${offset}`,
      this.database.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM "SupplierPriceSuggestion" s
        WHERE s.status = 'PENDING'
          AND (${supplier}::text IS NULL OR s."supplierId" = ${supplier})
          AND NOT EXISTS (
            SELECT 1 FROM "SupplierPriceMatch" m
            WHERE m."supplierId" = s."supplierId" AND m."supplierSku" = s."supplierSku")`,
    ]);
    return { ids: rows.map((row) => row.id), total: count[0]?.total ?? 0 };
  }

  /** A javaslatok részletei a megjelenítéshez, a megadott sorrendben. */
  async details(ids: readonly string[]) {
    const rows = await this.database.supplierPriceSuggestion.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        supplierId: true,
        supplierSku: true,
        variantId: true,
        score: true,
        basis: true,
        supplier: { select: { name: true } },
        variant: {
          select: {
            name: true,
            sku: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  /** A sorok legfrissebb listabeli adata beszállítónként és cikkszámonként. */
  async latestEntries(
    keys: readonly { supplierId: string; supplierSku: string }[],
  ) {
    const found = new Map<
      string,
      {
        supplierName: string | null;
        brand: string | null;
        gtin: string | null;
        unitPrice: string;
        currency: string;
      }
    >();
    const bySupplier = new Map<string, string[]>();
    for (const key of keys)
      bySupplier.set(key.supplierId, [
        ...(bySupplier.get(key.supplierId) ?? []),
        key.supplierSku,
      ]);
    for (const [supplierId, skus] of bySupplier)
      for (const part of chunks(skus, CHUNK))
        for (const entry of await this.database.supplierPriceListEntry.findMany(
          {
            where: {
              supplierSku: { in: part },
              list: { supplierId },
            },
            orderBy: [{ list: { listDate: "desc" } }, { id: "desc" }],
            select: {
              supplierSku: true,
              supplierName: true,
              brand: true,
              gtin: true,
              unitPrice: true,
              list: { select: { currency: true } },
            },
          },
        )) {
          const key = `${supplierId}|${entry.supplierSku}`;
          if (!found.has(key))
            found.set(key, {
              supplierName: entry.supplierName,
              brand: entry.brand,
              gtin: entry.gtin,
              unitPrice: entry.unitPrice.toString(),
              currency: entry.list.currency,
            });
        }
    return found;
  }

  /**
   * JÓVÁHAGYÁS: a javaslatból ember által jóváhagyott kötés lesz (`NAME`,
   * `APPROVED`), a cikkszám többi függő javaslata megszűnik, az elutasítottak
   * maradnak. Ami közben kötést kapott (automatikus vagy jóváhagyott), azt
   * kihagyjuk: embert nem írunk felül egy javaslattal. Egy tranzakció, auditsorral.
   */
  async approve(
    ids: readonly string[],
    userId: string,
  ): Promise<{ decided: number; skipped: number }> {
    return this.database.$transaction(async (transaction) => {
      let decided = 0;
      let skipped = 0;
      const approved: { id: string; supplierSku: string; variantId: string }[] =
        [];
      for (const id of ids) {
        const suggestion = await transaction.supplierPriceSuggestion.findUnique(
          { where: { id } },
        );
        if (!suggestion || suggestion.status !== "PENDING") {
          skipped += 1;
          continue;
        }
        const existing = await transaction.supplierPriceMatch.findUnique({
          where: {
            supplierId_supplierSku: {
              supplierId: suggestion.supplierId,
              supplierSku: suggestion.supplierSku,
            },
          },
          select: { id: true, status: true },
        });
        // a person's earlier rejection may be reversed by a person; anything else stands
        if (existing && existing.status !== "REJECTED") {
          skipped += 1;
          continue;
        }
        const now = new Date();
        const data = {
          variantId: suggestion.variantId,
          method: "NAME" as const,
          status: "APPROVED" as const,
          decidedById: userId,
          decidedAt: now,
        };
        if (existing)
          await transaction.supplierPriceMatch.update({
            where: { id: existing.id },
            data,
          });
        else
          await transaction.supplierPriceMatch.create({
            data: {
              supplierId: suggestion.supplierId,
              supplierSku: suggestion.supplierSku,
              ...data,
            },
          });
        await transaction.supplierPriceSuggestion.deleteMany({
          where: {
            supplierId: suggestion.supplierId,
            supplierSku: suggestion.supplierSku,
            status: "PENDING",
          },
        });
        approved.push({
          id,
          supplierSku: suggestion.supplierSku,
          variantId: suggestion.variantId,
        });
        decided += 1;
      }
      if (approved.length)
        await transaction.auditLog.create({
          data: {
            userId,
            action: "supplier-price-suggestion.approved",
            entityType: "SupplierPriceSuggestion",
            entityId: approved[0]!.id,
            metadata: { approved, skipped },
          },
        });
      return { decided, skipped };
    });
  }

  /** ELUTASÍTÁS: csak ez a jelölt marad elutasítva (nem jön vissza), a többi jelölt érintetlen. */
  async reject(
    ids: readonly string[],
    userId: string,
  ): Promise<{ decided: number; skipped: number }> {
    return this.database.$transaction(async (transaction) => {
      const { count } = await transaction.supplierPriceSuggestion.updateMany({
        where: { id: { in: [...ids] }, status: "PENDING" },
        data: {
          status: "REJECTED",
          decidedById: userId,
          decidedAt: new Date(),
        },
      });
      if (count > 0)
        await transaction.auditLog.create({
          data: {
            userId,
            action: "supplier-price-suggestion.rejected",
            entityType: "SupplierPriceSuggestion",
            entityId: ids[0]!,
            metadata: { ids: [...ids], rejected: count },
          },
        });
      return { decided: count, skipped: ids.length - count };
    });
  }
}
