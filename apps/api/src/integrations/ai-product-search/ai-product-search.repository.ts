import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

import { AI_PRODUCT_SEARCH_MAX_HITS } from "./ai-product-search.config.js";

/**
 * One product row, exactly as much of it as the projection needs.
 *
 * The select list IS the boundary of this feature, the same way it is in
 * `AiUserContextRepository`. What is not selected cannot be returned by
 * accident, and here that matters more than usual: `ProductExtension` sits
 * one relation away and holds purchase price and preferred supplier. A
 * generous `include` would carry both into a model context, and whatever
 * reaches a model context must be treated as spoken aloud.
 */
export interface ProductSearchRow {
  id: string;
  name: string;
  mirrorState: string | null;
  missingSince: Date | null;
  lastSyncedAt: Date | null;
  brand: { name: string } | null;
  categories: Array<{ category: { name: string } }>;
  variants: Array<{ sku: string; name: string | null }>;
  unasSnapshot: {
    descriptionShort: string | null;
    descriptionLong: string | null;
    parameters: unknown;
    netPrice: unknown;
    grossPrice: unknown;
    currency: string | null;
    reportedStock: unknown;
  } | null;
}

@Injectable()
export class AiProductSearchRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * Finds products whose name or description mentions the query.
   *
   * **This is deliberately the simplest possible matcher, and it is going to
   * be replaced.** Balazs's decision names PostgreSQL full-text as the first
   * search engine, with the requirement that it stay swappable for a vector
   * or hybrid search later. That engine is not built yet: the extension
   * inventory on the live instance is still being measured, and building a
   * matcher against an unmeasured instance is how one ends up with a migration
   * nobody can run.
   *
   * What matters is that the ENDPOINT and the PROJECTION do not care. A
   * caller sees the same shape whichever matcher is behind it, which is
   * exactly what "swappable" has to mean in practice - otherwise the word is
   * a promise rather than a property.
   */
  async search(
    query: string,
    limit: number,
  ): Promise<{ rows: ProductSearchRow[]; totalMatched: number }> {
    /**
     * Only what the shop can actually be asked about.
     *
     * `isActive` and `mirrorState` are two different statements: a product
     * can be active for us and missing from the source. A search result must
     * satisfy both, because it is an implicit "we have this".
     */
    const where = {
      isActive: true,
      mirrorState: "ACTIVE" as const,
      OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        {
          unasSnapshot: {
            descriptionShort: { contains: query, mode: "insensitive" as const },
          },
        },
        {
          unasSnapshot: {
            descriptionLong: { contains: query, mode: "insensitive" as const },
          },
        },
      ],
    };

    const select = {
      id: true,
      name: true,
      mirrorState: true,
      missingSince: true,
      lastSyncedAt: true,
      brand: { select: { name: true } },
      categories: { select: { category: { select: { name: true } } } },
      variants: {
        select: { sku: true, name: true },
        where: { isActive: true },
        orderBy: { sku: "asc" as const },
      },
      unasSnapshot: {
        select: {
          descriptionShort: true,
          descriptionLong: true,
          parameters: true,
          netPrice: true,
          grossPrice: true,
          currency: true,
          reportedStock: true,
        },
      },
    };

    /**
     * The total is counted separately, and it is not decoration: without it,
     * "there were no more results" and "we cut the list at ten" look
     * identical to the surface, and the person judging the answer cannot tell
     * a thin catalogue from a narrow window.
     */
    const [rows, totalMatched] = await Promise.all([
      this.database.product.findMany({
        where,
        select,
        take: Math.min(limit, AI_PRODUCT_SEARCH_MAX_HITS),
        orderBy: { name: "asc" },
      }),
      this.database.product.count({ where }),
    ]);

    return { rows: rows as ProductSearchRow[], totalMatched };
  }
}
