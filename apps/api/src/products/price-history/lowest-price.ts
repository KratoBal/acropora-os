import { Prisma } from "@acropora/database";

/**
 * THE LOWEST PRICE OF THE LAST 30 DAYS, FROM THE PRICE HISTORY (card 90c54873, V0.2, slice 1).
 *
 * WHAT IT IS FOR: the Omnibus line on the product page ("Legalacsonyabb ár az elmúlt 30 napban").
 * The shop shows it when the page announces a reduction; the number it names is the lowest price the
 * variant had in the 30 days before. This file only computes that number from the history rows. It
 * writes nothing and nothing calls it yet: the projection to the shop is the next slice.
 *
 * WHAT A HISTORY ROW MEANS: it is written when a price CHANGED (`unas-ar-tortenet.ts`), so a row is
 * the price from its `observedAt` until the next row. The price in force at the START of the
 * window is therefore the last row at or before it, even though no row was written inside the
 * window: a price that did not move for 40 days counts for the whole window.
 *
 * TWO SOURCES, ONE SERIES. The UNAS mirror rows are per product (`variantId` null) and carry the
 * list price and the sale price; a variant's price is the mirror's plus the variant's UNAS
 * surcharge. A product we have taken over has OWN rows per variant from the takeover day (the
 * variant's own gross price, no sale concept). The series of a taken-over variant is the mirror
 * rows BEFORE its first OWN row, then the OWN rows; a mirror row at or after the first OWN row is
 * dropped (the mirror is frozen at the takeover, and a stray row must not pull the answer).
 *
 * WHAT THE ANSWER SAYS ABOUT ITS OWN LIMIT. `complete` is true only when the history reaches back
 * to the start of the window. A variant whose history is younger than 30 days gets the lowest
 * price since its first row and `complete: false` with the date it begins: the caller (and the
 * lawyer) decides what the line may say then; this function does not guess.
 *
 * A SALE PRICE COUNTS AS THE PRICE IN FORCE. A mirror row with a sale price is the shop's price
 * from that observation on (the shop is sent the running sale price as its amount); the sale's own
 * start and end dates are not stored in the history, and do not need to be: the row that ends the
 * sale is written when the sale price disappears (the next sync, minutes later).
 */
export const OMNIBUS_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A price in force from `at` until the next point. `amount` null: no price was known. */
export interface PricePoint {
  at: Date;
  amount: Prisma.Decimal | null;
  currency: string | null;
}

export interface LowestPrice {
  amount: Prisma.Decimal;
  currency: string | null;
  /** the day the lowest price began to apply (the later of its row and the window start) */
  since: Date;
  windowStart: Date;
  asOf: Date;
  /** the history reaches back to the window start */
  complete: boolean;
  /** the first point we have; the window is shorter than 30 days when it is later than `windowStart` */
  historyBegins: Date;
}

/** The lowest price in force in `[asOf - days, asOf]`, or null when there is nothing to name. */
export function lowestPriceInWindow(
  points: readonly PricePoint[],
  asOf: Date,
  days: number = OMNIBUS_WINDOW_DAYS,
): LowestPrice | null {
  const windowStart = new Date(asOf.getTime() - days * DAY_MS);
  const ordered = points
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        a.point.at.getTime() - b.point.at.getTime() || a.index - b.index,
    )
    .map(({ point }) => point);
  // two points at the same instant: the later one in the input wins (the sort is stable)
  const settled = ordered.filter(
    (point, i) => ordered[i + 1]?.at.getTime() !== point.at.getTime(),
  );
  const known = settled.filter((point) => point.at.getTime() <= asOf.getTime());
  if (known.length === 0) return null;

  let best: LowestPrice | null = null;
  for (const [i, point] of known.entries()) {
    const next = known[i + 1];
    const from = Math.max(point.at.getTime(), windowStart.getTime());
    const until = next ? next.at.getTime() : asOf.getTime();
    // a segment that ended before the window began is not in the window; no price known: nothing to name
    if (until < windowStart.getTime() || point.amount === null) continue;
    if (best === null || point.amount.lessThan(best.amount))
      best = {
        amount: point.amount,
        currency: point.currency,
        since: new Date(from),
        windowStart,
        asOf,
        complete: false,
        historyBegins: known[0]!.at,
      };
  }
  if (best === null) return null;
  return {
    ...best,
    complete: best.historyBegins.getTime() <= windowStart.getTime(),
  };
}

export interface HistoryRow {
  variantId: string | null;
  observedAt: Date;
  createdAt: Date;
  currency: string | null;
  grossPrice: Prisma.Decimal | null;
  saleGrossPrice: Prisma.Decimal | null;
}

/**
 * The series of ONE variant from its product's history rows (the product's mirror rows and the
 * variant's own rows; rows of other variants are ignored). `surcharge` is the variant's UNAS
 * surcharge, added to every mirror price.
 */
export function seriesOfVariant(
  rows: readonly HistoryRow[],
  variantId: string,
  surcharge: Prisma.Decimal | null,
): PricePoint[] {
  const own = rows.filter((row) => row.variantId === variantId).sort(byTime);
  const firstOwn = own[0]?.observedAt.getTime() ?? Number.POSITIVE_INFINITY;
  const mirror = rows
    .filter((row) => row.variantId === null)
    .filter((row) => row.observedAt.getTime() < firstOwn)
    .sort(byTime);
  const extra = surcharge ?? new Prisma.Decimal(0);
  return [
    ...mirror.map((row): PricePoint => {
      const price = row.saleGrossPrice ?? row.grossPrice;
      return {
        at: row.observedAt,
        amount: price === null ? null : price.plus(extra),
        currency: row.currency,
      };
    }),
    ...own.map((row): PricePoint => ({
      at: row.observedAt,
      amount: row.grossPrice,
      currency: row.currency,
    })),
  ];
}

const byTime = (a: HistoryRow, b: HistoryRow) =>
  a.observedAt.getTime() - b.observedAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime();
