import { Prisma } from "@acropora/database";

import { availableToSell } from "../../inventory/available-to-sell.js";
import {
  addSurcharge,
  isSaleActive,
  resolvePriceSource,
  type MirrorPriceRow,
} from "../../integrations/medusa/medusa-price-source.js";
import { day } from "../../integrations/medusa/medusa-variant-omnibus.js";
import type { CatalogAuthority } from "../../products/catalog-authority.js";
import type { LowestPrice } from "../../products/price-history/lowest-price.js";
import { isOwnSaleActive } from "../../products/own-sale.js";
import {
  UNKNOWN,
  type ArrivalEntry,
  type ArrivalsData,
  type OmnibusData,
  type PriceData,
  type ProductData,
  type SaleData,
  type StockData,
  type UnknownSection,
  type VariantData,
} from "./product-data.types.js";

/**
 * THE FRESH-DATA VIEW OF A PRODUCT, AS PURE FUNCTIONS (task t54-friss-termekadat).
 *
 * NO DATABASE, NO CLOCK, NO NETWORK: the rows and `now` come in, the view goes out, so every "unknown" branch can be
 * made to fail by name. The price is NOT recomputed here: it is `resolvePriceSource`, the same decision the shop
 * projection uses, so the content agent can never print a price the shop does not show. The stock is
 * `availableToSell`, the one stock formula. The Omnibus value is `lowestPriceBeforeCurrentReduction`, computed by the
 * caller (it reads the history) and handed in.
 *
 * WHAT IS NOT HERE, BY DESIGN (spec 3): purchase price, margin, costing, supplier. The row types below list only what
 * the view reads; the repository selects exactly these fields.
 */

export interface VariantRow {
  id: string;
  sku: string;
  name: string | null;
  isActive: boolean;
  sellingGrossPrice: Prisma.Decimal | null;
  sellingPriceCurrency: string | null;
  sellingSaleGrossPrice: Prisma.Decimal | null;
  sellingSaleStartsAt: Date | null;
  sellingSaleEndsAt: Date | null;
  unasVariantExtraGrossPrice: Prisma.Decimal | null;
  /** a missing row is NOT "not tracked": the column defaults to tracked */
  extension: { stockTrackingEnabled: boolean } | null;
  stockItems: {
    onHand: Prisma.Decimal;
    reserved: Prisma.Decimal;
    updatedAt: Date;
  }[];
  /** the variant's lines in a CORRECTED stock count that carry a counted quantity */
  countedLines: { inventoryCount: { correctedAt: Date | null } }[];
  /** lines of orders already sent to the supplier and not fully received */
  purchaseLines: {
    orderedQuantity: Prisma.Decimal;
    receivedQuantity: Prisma.Decimal;
    expectedAt: Date | null;
    purchaseOrder: { expectedAt: Date | null; updatedAt: Date };
  }[];
}

export interface LivestockArrivalRow {
  expectedOn: Date;
  quantity: number | null;
  status: "ORDERED" | "IN_TRANSIT" | "ARRIVED";
  preorderable: boolean;
  updatedAt: Date;
}

export interface ProductRow {
  id: string;
  name: string;
  isActive: boolean;
  archivedAt: Date | null;
  type: "PHYSICAL" | "SERVICE" | "LIVESTOCK";
  catalogAuthority: CatalogAuthority | null;
  brand: { name: string } | null;
  categories: { category: { name: string } }[];
  channelListings: {
    channel: "UNAS" | "WEBSHOP";
    isPublished: boolean;
    productUrl: string | null;
  }[];
  unasSnapshot: (MirrorPriceRow & { productUrl: string | null }) | null;
  shippingProfile: { pickupOnly: boolean; isFrozen: boolean } | null;
  /** the newest history row per (product mirror | variant): `variantId` null is the mirror */
  priceChanges: { variantId: string | null; at: Date }[];
  livestockArrivals: LivestockArrivalRow[];
  variants: VariantRow[];
}

export interface ViewContext {
  now: Date;
  /**
   * The Omnibus reference per variant id, ONLY for variants whose sale runs (the caller reads the history). A variant
   * whose sale runs and that is absent here, or maps to null, gets "ismeretlen", never a made-up number.
   */
  omnibus: ReadonlyMap<string, LowestPrice | null>;
}

const unknown = (reason: string): UnknownSection => ({
  status: UNKNOWN,
  reason,
});

const iso = (at: Date) => at.toISOString();

function saleOf(
  row: ProductRow,
  variant: VariantRow,
  now: Date,
): SaleData | null {
  if (row.catalogAuthority === "ACROPORA") {
    const { sellingSaleGrossPrice: price, sellingSaleStartsAt: starts } =
      variant;
    const ends = variant.sellingSaleEndsAt;
    // the three fields stand or fall together; a partial row is no sale
    if (price === null || starts === null || ends === null) return null;
    if (isOwnSaleActive(variant, now))
      return {
        state: "fut",
        price: price.toString(),
        startsAt: iso(starts),
        endsAt: iso(ends),
        openEnded: false,
      };
    // the end is the first moment the regular price is back: at or after it the sale is over
    if (now >= ends) return null;
    return {
      state: "tervezett",
      price: price.toString(),
      startsAt: iso(starts),
      endsAt: iso(ends),
      openEnded: false,
    };
  }
  const mirror = row.unasSnapshot;
  if (row.catalogAuthority !== "UNAS" || !mirror) return null;
  const price = addSurcharge(
    mirror.saleGrossPrice,
    variant.unasVariantExtraGrossPrice,
  );
  if (price === null) return null;
  const running = isSaleActive(mirror, now);
  // not running and it started in the past: it ended
  if (!running && !(mirror.saleStartsAt !== null && now < mirror.saleStartsAt))
    return null;
  return {
    state: running ? "fut" : "tervezett",
    price: price.toString(),
    startsAt: mirror.saleStartsAt ? iso(mirror.saleStartsAt) : UNKNOWN,
    endsAt: mirror.saleEndsAt ? iso(mirror.saleEndsAt) : UNKNOWN,
    openEnded: mirror.saleEndsAt === null,
  };
}

function omnibusOf(
  sale: SaleData | null,
  variantId: string,
  context: ViewContext,
): OmnibusData {
  if (sale?.state !== "fut") return { status: "nincs futó akció" };
  const lowest = context.omnibus.get(variantId);
  if (lowest === undefined) return unknown("not-computed");
  if (lowest === null) return unknown("no-known-price-before-the-reduction");
  // a gap: the shop clears the key too (a misleading reference is worse than none)
  if (lowest.unknownInWindow) return unknown("gap-in-the-30-day-window");
  return {
    status: "ismert",
    amount: lowest.amount.toString(),
    currency: lowest.currency ?? UNKNOWN,
    reductionStart: day(lowest.reductionStart),
    historyBegins: day(lowest.historyBegins),
    complete: lowest.complete,
  };
}

function priceOf(
  row: ProductRow,
  variant: VariantRow,
  context: ViewContext,
): PriceData | UnknownSection {
  const mirror = row.unasSnapshot;
  const decision = resolvePriceSource({
    authority: row.catalogAuthority,
    mirror,
    own: {
      sellingGrossPrice: variant.sellingGrossPrice,
      sellingPriceCurrency: variant.sellingPriceCurrency,
    },
    ownSale: variant,
    variantSurcharge: variant.unasVariantExtraGrossPrice,
    now: context.now,
  });
  // the refusal is the answer: the reason code, not a guess at a price
  if (!decision.ok) return unknown(decision.reason);
  if (decision.price.sellingGrossPrice === null)
    return unknown("price-missing");

  const sale = saleOf(row, variant, context.now);
  const list =
    row.catalogAuthority === "ACROPORA"
      ? variant.sellingGrossPrice
      : addSurcharge(
          mirror?.grossPrice ?? null,
          variant.unasVariantExtraGrossPrice,
        );

  // the history rows that speak for this variant: the product's mirror rows and the variant's own
  const changes = row.priceChanges
    .filter((c) => c.variantId === null || c.variantId === variant.id)
    .map((c) => c.at.getTime());

  return {
    status: "ismert",
    currency: decision.price.sellingPriceCurrency ?? UNKNOWN,
    listPrice: list === null ? UNKNOWN : list.toString(),
    currentPrice: decision.price.sellingGrossPrice.toString(),
    sale,
    omnibus: omnibusOf(sale, variant.id, context),
    lastChangedAt:
      changes.length === 0 ? UNKNOWN : iso(new Date(Math.max(...changes))),
    priceSource:
      decision.source === "own" || decision.source === "own-sale"
        ? "Acropora OS"
        : "UNAS tükör",
  };
}

function stockOf(variant: VariantRow): StockData | UnknownSection {
  const counted = variant.countedLines
    .map((line) => line.inventoryCount.correctedAt)
    .filter((at): at is Date => at !== null);
  const reliability =
    variant.countedLines.length > 0 ? "leltározott" : "nem leltározott";
  const lastCountedAt =
    counted.length === 0
      ? UNKNOWN
      : iso(new Date(Math.max(...counted.map((at) => at.getTime()))));

  const base = { status: "ismert", reliability, lastCountedAt } as const;

  if (variant.extension?.stockTrackingEnabled === false)
    return {
      ...base,
      quantity: UNKNOWN,
      state: "nem követett",
      lastUpdatedAt: UNKNOWN,
    };

  // no stock row at all is NOT zero: we have no record, not a record of nothing
  if (variant.stockItems.length === 0)
    return {
      ...base,
      quantity: UNKNOWN,
      state: UNKNOWN,
      lastUpdatedAt: UNKNOWN,
    };

  const lastUpdatedAt = iso(
    new Date(Math.max(...variant.stockItems.map((s) => s.updatedAt.getTime()))),
  );
  const total = variant.stockItems.reduce(
    (sum, item) => sum.plus(availableToSell(item)),
    new Prisma.Decimal(0),
  );
  // a negative sum is reservations above what we know is on the shelf: neither "none" nor a number to print
  if (total.isNegative())
    return { ...base, quantity: UNKNOWN, state: UNKNOWN, lastUpdatedAt };
  return {
    ...base,
    quantity: total.toNumber(),
    state: total.isZero() ? "nincs" : "van",
    lastUpdatedAt,
  };
}

function arrivalsOf(
  row: ProductRow,
  variant: VariantRow,
): ArrivalsData | UnknownSection {
  const fromOrders = variant.purchaseLines.flatMap((line): ArrivalEntry[] => {
    const remaining = line.orderedQuantity.minus(line.receivedQuantity);
    // `isPositive()` is true for ZERO in decimal.js: a fully received line would stay on the list
    if (!remaining.greaterThan(0)) return [];
    const expected = line.expectedAt ?? line.purchaseOrder.expectedAt;
    return [
      {
        source: "beszerzési rendelés",
        expectedOn: expected ? day(expected) : UNKNOWN,
        quantity: remaining.toNumber(),
        state: "megrendelve",
        // an order line carries no pre-registration: unknown, not "no"
        preorderable: UNKNOWN,
        updatedAt: iso(line.purchaseOrder.updatedAt),
      },
    ];
  });
  const STATE = {
    ORDERED: "megrendelve",
    IN_TRANSIT: "úton",
    ARRIVED: "megérkezett",
  } as const;
  const fromLivestock = row.livestockArrivals.map((arrival): ArrivalEntry => ({
    source: "élőállat-érkezés",
    expectedOn: day(arrival.expectedOn),
    quantity: arrival.quantity ?? UNKNOWN,
    state: STATE[arrival.status],
    preorderable: arrival.preorderable,
    updatedAt: iso(arrival.updatedAt),
  }));
  const recorded = [...fromOrders, ...fromLivestock].sort((a, b) =>
    a.expectedOn === b.expectedOn
      ? 0
      : a.expectedOn === UNKNOWN
        ? 1
        : b.expectedOn === UNKNOWN
          ? -1
          : a.expectedOn < b.expectedOn
            ? -1
            : 1,
  );
  return { status: "ismert", complete: false, recorded };
}

function fulfilmentOf(row: ProductRow): VariantData["fulfilment"] {
  const profile = row.shippingProfile;
  if (!profile) return UNKNOWN;
  return profile.pickupOnly || profile.isFrozen
    ? "csak bolti átvétel"
    : "szállítással";
}

/** The variants whose sale runs now: the ones that need an Omnibus reference (the caller reads the history for them). */
export function runningSaleVariantIds(row: ProductRow, now: Date): string[] {
  return row.variants
    .filter((variant) => {
      const price = priceOf(row, variant, { now, omnibus: new Map() });
      return price.status === "ismert" && price.sale?.state === "fut";
    })
    .map((variant) => variant.id);
}

export function buildProductData(
  row: ProductRow,
  context: ViewContext,
): ProductData {
  const channel = (which: "UNAS" | "WEBSHOP") => {
    const listing = row.channelListings.find((l) => l.channel === which);
    if (!listing) return { published: UNKNOWN, url: UNKNOWN };
    const url =
      listing.productUrl ??
      (which === "UNAS" ? row.unasSnapshot?.productUrl : null) ??
      null;
    return { published: listing.isPublished, url: url ?? UNKNOWN };
  };

  return {
    id: row.id,
    name: row.name,
    active: row.isActive && row.archivedAt === null,
    brand: row.brand?.name ?? UNKNOWN,
    categories: row.categories.map((c) => c.category.name).sort(),
    livestock: row.type === "LIVESTOCK",
    channels: { unas: channel("UNAS"), webshop: channel("WEBSHOP") },
    variants: row.variants.map((variant): VariantData => ({
      sku: variant.sku,
      name: variant.name ?? UNKNOWN,
      active: variant.isActive,
      price: priceOf(row, variant, context),
      stock: stockOf(variant),
      fulfilment: fulfilmentOf(row),
      arrivals: arrivalsOf(row, variant),
    })),
  };
}
