import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

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
    ): Promise<{ id: string; sku: string; name: string }[]>;
  };
}

export interface PriceStopView {
  productId: string;
  /** null when the product row is gone (the reference outlived it) */
  sku: string | null;
  name: string | null;
  failedAt: string;
  /** one entry per failure kind: `needsPerson` is true for the human data states (the round is not failed for them), false for a run failure that retries by itself */
  kinds: { kind: string; needsPerson: boolean }[];
  reasons: string[];
  /** the stored reason reached the write's 300-character cut: the last message may be cut and its kind then reads `truncated` */
  reasonCut: boolean;
}

export interface PriceStopsView {
  /** every stored stop, not only this page */
  total: number;
  /** how many of them have at least one kind a person has to act on */
  needingPerson: number;
  /** true when more than `PRICE_STOPS_LIMIT` stops exist and the list is cut (the person-first, newest-first order is kept) */
  truncated: boolean;
  stops: PriceStopView[];
}

/**
 * THE STORED PRICE STOPS AS A LIST (task t-20261117-arstop-lista; acrobot 55208): read-only. It reads the price reference rows and the products' sku and
 * name, and writes nothing. SKU AND NAME COME FROM THE PRODUCT ROW (by the reference's entityId), not from the stored reason text: the text is cut at 300
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

  async list(): Promise<PriceStopsView> {
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
    const products = page.length
      ? await this.db.product.findMany({
          where: { id: { in: page.map((stop) => stop.productId) } },
          select: { id: true, sku: true, name: true },
        })
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      total: stored.length,
      needingPerson: stored.filter((stop) => needsPerson(stop.kinds)).length,
      truncated: stored.length > PRICE_STOPS_LIMIT,
      stops: page.map((stop) => ({
        productId: stop.productId,
        sku: byId.get(stop.productId)?.sku ?? null,
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
