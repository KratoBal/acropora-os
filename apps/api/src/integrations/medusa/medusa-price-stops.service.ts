import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type { MedusaPriceStopsView } from "@acropora/types";

import {
  priceFailureIsRunFailure,
  storedPriceStops,
  type PriceSyncDatabase,
} from "./medusa-price-sync.js";

/** Test seam only (the pattern of the price audit): the real database is the shared Prisma client. */
export const MEDUSA_PRICE_STOPS_DB = Symbol("MEDUSA_PRICE_STOPS_DB");

export const PRICE_STOPS_LIMIT = 500;

export interface PriceStopsDatabase extends Pick<
  PriceSyncDatabase,
  "externalReference"
> {
  product: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; name: string; variants: { sku: string }[] }[]>;
  };
}

/**
 * THE STORED PRICE STOPS AS A LIST (task t-20261117-arstop-lista; acrobot 55208): read-only. It reads the price reference rows and the products' sku and
 * name, and writes nothing. THE NAME COMES FROM THE PRODUCT ROW and THE SKUS FROM ITS VARIANTS (by the reference's entityId; the sku field is on `ProductVariant`: the first version of this select named it on `Product`, which the schema guard in CI refused, #2666), not from the stored reason text: the text is cut at 300
 * characters and its first words are only usually the sku.
 */
@Injectable()
export class MedusaPriceStopsService {
  private readonly db: PriceStopsDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_PRICE_STOPS_DB)
    db?: PriceStopsDatabase,
  ) {
    this.db = db ?? (prisma as unknown as PriceStopsDatabase);
  }

  async list(): Promise<MedusaPriceStopsView> {
    const stored = await storedPriceStops(this.db);
    // THE KINDS ARE KNOWN WITHOUT THE PRODUCT ROW, so the order (a person's work first, then the newest) and the cut come BEFORE the product query: the
    // `in` list is at most `PRICE_STOPS_LIMIT` long, however many references stopped (a `run-threw` round writes a failure for every priceable product;
    // Prisma sends every element as its own parameter and a query over 32767 fails, measured on #2019; barracuda, #2666)
    const needsPerson = (kinds: string[]) =>
      kinds.some((kind) => !priceFailureIsRunFailure(kind));
    // `storedPriceStops` sorts newest first and this sort is stable
    const ordered = [...stored].sort(
      (a, b) => Number(needsPerson(b.kinds)) - Number(needsPerson(a.kinds)),
    );
    const page = ordered.slice(0, PRICE_STOPS_LIMIT);
    // the call stays INLINE (the schema guard in CI reads the select of a `<model>.findMany({ ... })` call and checks every field against the schema),
    // and `satisfies` checks the same args against the real Prisma types at compile time: the db seam is loosely typed for the tests, and a cast to it
    // hid a field that does not exist (the narrow type check could not see it)
    const products = page.length
      ? await this.db.product.findMany({
          where: { id: { in: page.map((stop) => stop.productId) } },
          select: {
            id: true,
            name: true,
            variants: { select: { sku: true }, orderBy: { sku: "asc" } },
          },
        } satisfies Prisma.ProductFindManyArgs)
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      total: stored.length,
      needingPerson: stored.filter((stop) => needsPerson(stop.kinds)).length,
      truncated: stored.length > PRICE_STOPS_LIMIT,
      stops: page.map((stop) => ({
        productId: stop.productId,
        skus:
          byId.get(stop.productId)?.variants.map((variant) => variant.sku) ??
          [],
        name: byId.get(stop.productId)?.name ?? null,
        failedAt: stop.failedAt,
        kinds: stop.kinds.map((kind) => ({
          kind,
          needsPerson: !priceFailureIsRunFailure(kind),
        })),
        reasons: stop.reasons,
        reasonCut: stop.reasonCut,
      })),
    };
  }
}
