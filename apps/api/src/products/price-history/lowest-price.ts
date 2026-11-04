import { Prisma } from "@acropora/database";

/**
 * THE LOWEST PRICE OF THE 30 DAYS BEFORE A PRICE REDUCTION, FROM THE PRICE HISTORY (card 90c54873,
 * V0.2, slice 1).
 *
 * WHAT IT IS FOR: the Omnibus line on the product page. The reference price of an announced
 * reduction is the lowest price the variant had in the 30 days BEFORE THE REDUCTION BEGAN (Directive
 * 98/6/EC art. 6a; acrobot's decision on #2120, 2026-11-04). It is NOT the 30 days up to today: the
 * running sale price can never be its own reference. This file only computes the number from the
 * history rows. It writes nothing.
 *
 * THE WINDOW IS `[reductionStart - 30 days, reductionStart)`: the end is EXCLUSIVE, so a point that
 * begins AT `reductionStart` (the sale price itself) is not in it. `reductionStart` is the caller's
 * to know (today: the start of the Medusa sale price list, or the UNAS sale's first day from the
 * mirror rows). Nothing here defaults it to "now", and when the caller does not know it there is no
 * value and no guess.
 *
 * KNOWN LIMITS, stated here so the line's text can respect them:
 *  - a STEPPED reduction (a second cut right after the first) is measured against the FIRST cut's
 *    start; the caller must pass that day. Not solved yet: OPEN.
 *  - the window is 30 x 24 hours. Across the clock change (2026-10-25) that differs by an hour from
 *    30 calendar days; the history has instants, not days, and the hour matters only when a price
 *    moved inside it.
 *  - the variant's UNAS surcharge is TODAY'S value, added to every old mirror row: there is no
 *    surcharge history, so if the surcharge changed inside the window the old prices are off by
 *    the difference. Whether UNAS adds the surcharge to the sale price as well is NOT measured.
 *  - ONE CURRENCY: a series that mixes two currencies inside the window has no answer (null).
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
 * WHAT THE ANSWER SAYS ABOUT ITS OWN LIMIT. `complete` is true only when EVERY moment of the window
 * has a known price: the first known price is at or before the window start AND no unknown (null)
 * stretch reaches into the window. A variant whose history is younger than 30 days, or has an
 * unknown stretch in it, gets the lowest KNOWN price and `complete: false`: the caller (and the
 * lawyer) decides what the line may say then; this function does not guess. An unknown price is a
 * gap, never zero, and never covered time.
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
  /** the start of the reduction: the (exclusive) end of the window */
  reductionStart: Date;
  /** every moment of the window has a known price */
  complete: boolean;
  /** the first point with a known price; the window is shorter than 30 days when it is later than `windowStart` */
  historyBegins: Date;
}

/**
 * The lowest price in force in `[reductionStart - days, reductionStart)`, or null when there is
 * nothing to name (no known price in the window, or two currencies in it).
 */
export function lowestPriceInWindow(
  points: readonly PricePoint[],
  reductionStart: Date,
  days: number = OMNIBUS_WINDOW_DAYS,
): LowestPrice | null {
  const windowStart = new Date(reductionStart.getTime() - days * DAY_MS);
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
  // a point AT the reduction start is the reduced price itself: it is not before the reduction
  const known = settled.filter(
    (point) => point.at.getTime() < reductionStart.getTime(),
  );
  const firstPriced = known.find((point) => point.amount !== null);
  if (!firstPriced) return null;

  let best: LowestPrice | null = null;
  let unknownInWindow = false;
  const currencies = new Set<string>();
  for (const [i, point] of known.entries()) {
    const next = known[i + 1];
    const from = Math.max(point.at.getTime(), windowStart.getTime());
    const until = next ? next.at.getTime() : reductionStart.getTime();
    // a segment that ended at or before the window began is not in the window
    if (until <= windowStart.getTime()) continue;
    if (point.amount === null) {
      unknownInWindow = true;
      continue;
    }
    if (point.currency !== null) currencies.add(point.currency);
    if (best === null || point.amount.lessThan(best.amount))
      best = {
        amount: point.amount,
        currency: point.currency,
        since: new Date(from),
        windowStart,
        reductionStart,
        complete: false,
        historyBegins: firstPriced.at,
      };
  }
  if (best === null || currencies.size > 1) return null;
  return {
    ...best,
    complete:
      !unknownInWindow && best.historyBegins.getTime() <= windowStart.getTime(),
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
