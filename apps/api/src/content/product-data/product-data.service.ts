import {
  BadRequestException,
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
  unknownCategoryIds,
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
      if (query.categoryIds) {
        const tree = await this.repository.categoryTree();
        // a value that is not a category id is an ERROR, not "0 products": 0 reads as an empty category (acceptance A5)
        const unknown = unknownCategoryIds(query.categoryIds, tree);
        if (unknown.length > 0)
          throw new BadRequestException(
            `Ismeretlen kategória-azonosító: ${unknownNamed(unknown)}. A category szűrő kategória-AZONOSÍTÓT vár (a termék categories mezőjének id-ja), nem nevet. Ez hiba, nem üres kategória.`,
          );
        query.categoryIds = categoryDescendants(query.categoryIds, tree);
      }
      const where = productDataWhere(query, now);
      const identifiers = request.query.identifiers;
      const [totalMatched, rows, existing] = await Promise.all([
        this.repository.count(where),
        this.repository.rows(
          where,
          { take: request.limit, skip: request.offset },
          now,
        ),
        identifiers
          ? this.repository.existing(identifiers)
          : Promise.resolve([]),
      ]);

      const omnibus = await this.omnibusFor(rows, now);
      return {
        queriedAt: now.toISOString(),
        source: "Acropora OS",
        products: rows.map((row) => buildProductData(row, { now, omnibus })),
        notFound: notFound(identifiers, existing),
        totalMatched,
        truncated: request.offset + rows.length < totalMatched,
      };
    } catch (error) {
      // a bad request is the caller's to fix and says so; only a failed READ is the 503 below
      if (error instanceof BadRequestException) throw error;
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

/** At most this many unknown category values are named in the 400, the rest are counted: a long query string must not echo back whole. */
const MAX_UNKNOWN_NAMED = 10;

/** The unknown category values for the 400 message: the first ones (80 characters each), then "és még N". */
export function unknownNamed(unknown: readonly string[]): string {
  const named = unknown
    .slice(0, MAX_UNKNOWN_NAMED)
    .map((id) => id.slice(0, 80));
  const rest = unknown.length - named.length;
  return rest > 0 ? `${named.join(", ")} és még ${rest}` : named.join(", ");
}

/** Requested identifiers that match NO product id and NO variant SKU anywhere (not "not on this page"). */
export function notFound(
  requested: readonly string[] | undefined,
  existing: readonly { id: string; variants: { sku: string }[] }[],
): string[] {
  if (!requested) return [];
  const known = new Set(
    existing.flatMap((product) => [
      product.id,
      ...product.variants.map((variant) => variant.sku),
    ]),
  );
  return requested.filter((identifier) => !known.has(identifier));
}
