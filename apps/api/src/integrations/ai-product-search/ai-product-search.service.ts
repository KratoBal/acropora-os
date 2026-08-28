import { Injectable } from "@nestjs/common";

import {
  AI_PRODUCT_SEARCH_MAX_HITS,
  AI_PRODUCT_SEARCH_PROJECTION_VERSION,
} from "./ai-product-search.config.js";
import {
  AiProductSearchRepository,
  type ProductSearchRow,
} from "./ai-product-search.repository.js";
import { chooseDescription } from "./ai-product-search.document.js";
import type {
  AiProductSearchHit,
  AiProductSearchResult,
} from "./ai-product-search.types.js";

/** Prisma `Decimal` and friends: anything with a numeric string form. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class AiProductSearchService {
  constructor(private readonly repository: AiProductSearchRepository) {}

  async search(input: {
    query: string;
    limit?: number;
  }): Promise<AiProductSearchResult> {
    const query = input.query.trim();
    const limit = Math.min(
      Math.max(input.limit ?? AI_PRODUCT_SEARCH_MAX_HITS, 1),
      AI_PRODUCT_SEARCH_MAX_HITS,
    );

    const { rows, totalMatched } = await this.repository.search(query, limit);
    const hits = rows.map((row) => this.project(row));

    return {
      query,
      hits,
      totalMatched,
      oldestSyncedAt: oldestOf(hits),
      projectionVersion: AI_PRODUCT_SEARCH_PROJECTION_VERSION,
    };
  }

  /**
   * One row into one projected hit.
   *
   * Written as its own method rather than inline, so that "what the AI is
   * given" is a thing a test can call. A projection that only exists inside a
   * request handler is a projection nobody measures - and this one carries
   * the rule that price and stock stay structured, which is exactly the kind
   * of rule that erodes quietly.
   */
  private project(row: ProductSearchRow): AiProductSearchHit {
    const snapshot = row.unasSnapshot;
    const chosen = chooseDescription(row);
    const net = toNumber(snapshot?.netPrice);
    const gross = toNumber(snapshot?.grossPrice);
    const reported = toNumber(snapshot?.reportedStock);

    return {
      productId: row.id,
      sku: row.variants[0]?.sku ?? null,
      name: row.name,
      brand: row.brand?.name ?? null,
      categories: row.categories.map((entry) => entry.category.name),
      /**
       * Cleaned here rather than passed through, because this is the first
       * place the description leaves our side. What travels from here is
       * treated as spoken aloud, and until now that included the markup:
       * measured on the live catalogue, 774 products carry literal tags
       * while claiming to be plain text. `plainText` looks at the content
       * instead of at that claim - see its own file for why.
       */
      descriptionShort: chosen.short,
      descriptionLong: chosen.long,
      /**
       * MELYIK LEIRAST HASZNALTUK. A ket forras kozott a tulajdonjog dont, es
       * ha a valasz nem mondja meg, melyiket olvasta, egy tarolt itelet
       * utolag ertelmezhetetlen: "a leiras rossz volt" mast jelent, ha a
       * boltbol jott, es mast, ha valaki itt szerkesztette.
       */
      descriptionSource: chosen.source,
      parameters: snapshot?.parameters ?? null,
      variants: row.variants.map((variant) => ({
        sku: variant.sku,
        name: variant.name,
      })),
      /**
       * Null when the snapshot carries no price at all, which is a different
       * statement from "it costs zero" - and the only one of the two that is
       * honest when we simply do not know.
       */
      price:
        net === null && gross === null
          ? null
          : { net, gross, currency: snapshot?.currency ?? null },
      /**
       * Today only the UNAS-reported quantity is available here, and the
       * projection SAYS so rather than presenting it as ours. The POS answers
       * "which number counts" in a fixed order - our own stock first, then
       * this one - and when that order is wired in, only the `source` field
       * changes, not the shape.
       */
      stock:
        reported === null
          ? null
          : { quantity: reported, source: "unas" as const },
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      mirrorState: row.mirrorState,
      missingSince: row.missingSince?.toISOString() ?? null,
    };
  }
}

/**
 * The oldest sync time among the hits.
 *
 * One number that answers "how stale can this answer be at worst". A stopped
 * sync otherwise produces confident answers from old data, and nothing on the
 * screen would show it.
 */
function oldestOf(hits: AiProductSearchHit[]): string | null {
  const stamps = hits
    .map((hit) => hit.lastSyncedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return stamps[0] ?? null;
}
