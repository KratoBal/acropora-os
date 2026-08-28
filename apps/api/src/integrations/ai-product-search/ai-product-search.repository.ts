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
  /** A forrásválasztás két bemenete - lásd `chooseDescription`. */
  catalogAuthority: string | null;
  description: string | null;
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
    /** When the reported quantity was last synced - its own time, not the row's. */
    reportedStockSyncedAt: Date | null;
    /** When the snapshot row was last written; the price's time. */
    updatedAt: Date;
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
     * THE ENGINE, BEHIND ITS OWN BOUNDARY.
     *
     * What comes back from here is a ranked list of `{ productId, score }`
     * and nothing else - the engine never sees a price, a stock level or a
     * purchase cost, and the projection never learns HOW a product was found.
     * A different engine tomorrow answers the same two questions.
     */
    const ranked = await this.rank(query, limit);

    if (ranked.rows.length === 0)
      return { rows: [], totalMatched: ranked.totalMatched };

    const order = new Map(
      ranked.rows.map((row, index) => [row.productId, index]),
    );

    /**
     * Only what the shop can actually be asked about.
     *
     * `isActive` and `mirrorState` are two different statements: a product
     * can be active for us and missing from the source. A search result must
     * satisfy both, because it is an implicit "we have this".
     */
    const where = { id: { in: ranked.rows.map((row) => row.productId) } };

    const select = {
      id: true,
      name: true,
      /**
       * A forrásválasztáshoz, nem a válaszhoz: ez a kettő dönti el, hogy a
       * SAJÁT leírásunk vagy a tükrözött megy-e a modell elé.
       */
      catalogAuthority: true,
      description: true,
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
          reportedStockSyncedAt: true,
          updatedAt: true,
        },
      },
    };

    /**
     * The total is counted separately, and it is not decoration: without it,
     * "there were no more results" and "we cut the list at ten" look
     * identical to the surface, and the person judging the answer cannot tell
     * a thin catalogue from a narrow window.
     */
    const rows = await this.database.product.findMany({ where, select });

    /**
     * A MOTOR SORRENDJE DÖNT, NEM AZ ADATBÁZISÉ.
     *
     * A `findMany` az azonosítókra szűr, és a visszaadott sorrendje nem
     * definiált. Ha itt nem rendeznénk vissza, a rangsor - a lépés egyetlen
     * érdemi terméke - némán elveszne, és a találatok látszólag helyesek
     * maradnának.
     */
    const ordered = [...(rows as ProductSearchRow[])].sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );

    return { rows: ordered, totalMatched: ranked.totalMatched };
  }

  /**
   * A rangsor, és semmi más.
   *
   * Nyers SQL, mert a Prisma nem ismeri a `tsvector` típust és a
   * `ts_rank_cd` függvényt. A rendezés harmadik és negyedik kulcsa nem
   * díszítés: azonos pontszámnál a sorrendnek megismételhetőnek kell lennie,
   * különben két futás összehasonlíthatatlan - és a belső tesztfelület
   * pontosan összehasonlításra való.
   */
  private async rank(
    query: string,
    limit: number,
  ): Promise<{
    rows: Array<{ productId: string; score: number }>;
    totalMatched: number;
  }> {
    const terms = query
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((word) => word.length > 0);

    /**
     * Üres kérdésre üres válasz, hívás nélkül. A `to_tsquery` egy üres
     * kifejezésre hibát dob, és egy hibaüzenet ugyanolyan üres eredmény,
     * csak drágábban és zajosabban.
     */
    if (terms.length === 0) return { rows: [], totalMatched: 0 };

    /**
     * MINDEN SZO PREFIXKENT MEGY BE, ES EZ EGY MERT HIANYT POTOL.
     *
     * A magyar Snowball szotar ugyanannak a szonak a ket alakjabol KET
     * KULONBOZO tovet kepez, mert a szovegi `-m`-et is ragnak nezi:
     *
     *     to_tsvector('acropora_hu','Akvarium')  -> 'akvariu'
     *     to_tsvector('acropora_hu','Akvariumi') -> 'akvarium'
     *
     * Pontos toillesztessel tehat az „akvarium" kerdes NEM talalja meg az
     * „Akvariumi kavics" terméket - a hiba pedig nema, mert a kereses ilyenkor
     * is ad talalatokat, csak kevesebbet. Mérve a proba-katalóguson: pontos
     * illesztéssel 2, prefixszel 4, és a katalógusból KÜLÖN számolt szám is 4.
     *
     * A prefix a szó VÉGÉT hagyja szabadon, tehát pontosan azt a ragozást
     * fedi le, amit a szótár egyenetlenül vág le. Ára van: a rövid szó tágabb
     * halmazt fog. Ezt vállaljuk, mert a modell teljes szavakat ír be, és egy
     * termékkeresésnél a kimaradó találat drágább, mint egy tágabb lista.
     */
    const expression = terms.map((word) => `${word}:*`).join(" & ");
    const take = Math.min(limit, AI_PRODUCT_SEARCH_MAX_HITS);

    const [rows, counted] = await Promise.all([
      this.database.$queryRaw<Array<{ productId: string; score: number }>>`
        SELECT "productId", ts_rank_cd("searchVector", query) AS score
        FROM "AiProductSearchDocument", to_tsquery('acropora_hu', ${expression}) AS query
        WHERE "isSearchable" AND "searchVector" @@ query
        ORDER BY score DESC, title ASC, "productId" ASC
        LIMIT ${take}
      `,
      this.database.$queryRaw<Array<{ total: bigint }>>`
        SELECT count(*) AS total
        FROM "AiProductSearchDocument", to_tsquery('acropora_hu', ${expression}) AS query
        WHERE "isSearchable" AND "searchVector" @@ query
      `,
    ]);

    return {
      rows,
      totalMatched: Number(counted[0]?.total ?? 0),
    };
  }
}
