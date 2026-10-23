import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  SupplierPriceSuggestionDecision,
  SupplierPriceSuggestionItem,
  SupplierPriceSuggestionsResponse,
} from "@acropora/types";

import { buildNameIndex, suggestByName } from "./name-suggestions.js";
import { PriceListSuggestionRepository } from "./price-list-suggestion.repository.js";

export const SUGGESTION_PAGE_SIZE = 100;
export const MAX_DECIDE_IDS = 200;

/**
 * NÉV ALAPÚ JAVASLATOK AZ ÁRLISTA-SOROKHOZ (task arlista-nev-javaslat; Balázs
 * 2026-10-23 20:10 UTC: a név-keresés alapértelmezett, jóváhagyással). A javaslat
 * NEM kötés: a lista azon soraira készül, amelyek cikkszámához nincs kötés (se
 * automatikus, se jóváhagyott, se elutasított), és egy ember dönt. Az elutasított
 * jelölt nem jön vissza, a többi jelölt igen.
 */
@Injectable()
export class PriceListSuggestionService {
  constructor(private readonly repository: PriceListSuggestionRepository) {}

  /** A lista kötés nélküli soraira javaslatot készít; a már álló javaslatokat nem érinti. */
  async generateForList(listId: string): Promise<{
    considered: number;
    withSuggestion: number;
    stored: number;
  }> {
    const list = await this.repository.list(listId);
    if (!list) throw new NotFoundException("Nincs ilyen árlista.");
    const entries = await this.repository.unmatchedEntries(
      list.id,
      list.supplierId,
    );
    if (entries.length === 0)
      return { considered: 0, withSuggestion: 0, stored: 0 };
    const index = buildNameIndex(await this.repository.candidates());
    const found = entries.flatMap((entry) =>
      suggestByName(index, {
        supplierSku: entry.supplierSku,
        name: entry.supplierName,
        brand: entry.brand,
      }),
    );
    const stored = await this.repository.saveSuggestions(
      list.supplierId,
      found,
    );
    return {
      considered: entries.length,
      withSuggestion: new Set(found.map((suggestion) => suggestion.supplierSku))
        .size,
      stored,
    };
  }

  /** A függő javaslatok egy lapja, a lista sorának adataival és a jelölt termékkel. */
  async pending(
    supplierId: string | undefined,
    offset: number,
  ): Promise<SupplierPriceSuggestionsResponse> {
    const { ids, total } = await this.repository.pendingIds(
      supplierId,
      SUGGESTION_PAGE_SIZE,
      offset,
    );
    const rows = await this.repository.details(ids);
    const entries = await this.repository.latestEntries(rows);
    return {
      total,
      items: rows.map((row): SupplierPriceSuggestionItem => {
        const entry = entries.get(`${row.supplierId}|${row.supplierSku}`);
        const basis = row.basis as SupplierPriceSuggestionItem["basis"];
        return {
          id: row.id,
          supplierId: row.supplierId,
          supplierName: row.supplier.name,
          supplierSku: row.supplierSku,
          listedName: entry?.supplierName ?? null,
          listedBrand: entry?.brand ?? null,
          gtin: entry?.gtin ?? null,
          unitPrice: entry?.unitPrice ?? null,
          currency: entry?.currency ?? null,
          variantId: row.variantId,
          variantName: row.variant.name ?? row.variant.product.name,
          variantSku: row.variant.sku,
          score: Number(row.score),
          basis: {
            commonWords: basis.commonWords ?? [],
            sizes: basis.sizes ?? [],
            brand: basis.brand ?? null,
          },
        };
      }),
    };
  }

  approve(
    ids: readonly string[],
    userId: string,
  ): Promise<SupplierPriceSuggestionDecision> {
    return this.repository.approve(unique(ids), userId);
  }

  reject(
    ids: readonly string[],
    userId: string,
  ): Promise<SupplierPriceSuggestionDecision> {
    return this.repository.reject(unique(ids), userId);
  }
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
