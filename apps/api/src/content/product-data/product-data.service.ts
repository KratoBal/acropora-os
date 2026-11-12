import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  lowestPriceBeforeCurrentReduction,
  type LowestPriceDatabase,
} from "../../products/price-history/lowest-price.reader.js";
import type { LowestPrice } from "../../products/price-history/lowest-price.js";
import type { ProductDataRequest } from "./product-data.query.js";
import {
  categoryDescendants,
  productDataWhere,
  ProductDataRepository,
} from "./product-data.repository.js";
import type { ProductDataResponse } from "./product-data.types.js";
import {
  buildProductData,
  runningSaleVariantIds,
  type ProductRow,
} from "./product-data.view.js";

/** Test seams, provided optionally: the clock and the Omnibus reader. Production uses the real ones. */
export const PRODUCT_DATA_CLOCK = Symbol("PRODUCT_DATA_CLOCK");
export const PRODUCT_DATA_OMNIBUS_READER = Symbol(
  "PRODUCT_DATA_OMNIBUS_READER",
);
export type OmnibusReader = (
  variantId: string,
  now: Date,
) => Promise<LowestPrice | null>;

const defaultOmnibusReader: OmnibusReader = (variantId, now) =>
  lowestPriceBeforeCurrentReduction(
    prisma as unknown as LowestPriceDatabase,
    variantId,
    now,
  );

/**
 * READ-ONLY, TIME-STAMPED PRODUCT DATA FOR THE CONTENT AGENT (task t54-friss-termekadat, spec 1 to 4).
 *
 * THE FAILURE PATH IS AN ERROR, NEVER AN EMPTY ANSWER (spec 4, "the point that matters most"). Any failure to read,
 * from the product rows to the price history, ends in a 503 with a message that says it is NOT an empty result. It
 * is never caught into `[]`, a zero or a default, because an empty list reads as "no stock" or "no sale" and the agent
 * would print it. Nothing here writes: the repository has no write method, and this class calls none.
 */
@Injectable()
export class ProductDataService {
  private readonly logger = new Logger(ProductDataService.name);

  constructor(
    private readonly repository: ProductDataRepository,
    @Optional() @Inject(PRODUCT_DATA_CLOCK) private readonly clock?: () => Date,
    @Optional()
    @Inject(PRODUCT_DATA_OMNIBUS_READER)
    private readonly omnibusReader?: OmnibusReader,
  ) {}

  async read(request: ProductDataRequest): Promise<ProductDataResponse> {
    // the read's moment is taken BEFORE the reads: the answer is at most this old, never newer than it says
    const now = (this.clock ?? (() => new Date()))();
    try {
      const query = { ...request.query };
      if (query.categoryIds)
        query.categoryIds = categoryDescendants(
          query.categoryIds,
          await this.repository.categoryTree(),
        );
      const where = productDataWhere(query, now);
      const [totalMatched, rows] = await Promise.all([
        this.repository.count(where),
        this.repository.rows(
          where,
          { take: request.limit, skip: request.offset },
          now,
        ),
      ]);

      const omnibus = await this.omnibusFor(rows, now);
      return {
        queriedAt: now.toISOString(),
        source: "Acropora OS",
        products: rows.map((row) => buildProductData(row, { now, omnibus })),
        notFound: notFound(request.query.identifiers, rows),
        totalMatched,
        truncated: request.offset + rows.length < totalMatched,
      };
    } catch (error) {
      this.logger.error(
        "A friss termékadat olvasása elbukott",
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        "Az Acropora OS termékadata most nem olvasható. Ez HIBA, nem üres eredmény: nem jelenti, hogy nincs készlet vagy akció.",
      );
    }
  }

  /** The Omnibus reference, only for variants whose sale runs now (the others need none). */
  private async omnibusFor(rows: ProductRow[], now: Date) {
    const read = this.omnibusReader ?? defaultOmnibusReader;
    const ids = rows.flatMap((row) => runningSaleVariantIds(row, now));
    const entries = await Promise.all(
      ids.map(async (id) => [id, await read(id, now)] as const),
    );
    return new Map(entries);
  }
}

/** Requested identifiers that matched neither a product id nor a variant SKU. */
export function notFound(
  requested: readonly string[] | undefined,
  rows: readonly ProductRow[],
): string[] {
  if (!requested) return [];
  const known = new Set(
    rows.flatMap((row) => [row.id, ...row.variants.map((v) => v.sku)]),
  );
  return requested.filter((identifier) => !known.has(identifier));
}
