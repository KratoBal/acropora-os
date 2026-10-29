import { Prisma } from "@acropora/database";
import type {
  PosPaymentSummaryCell,
  PosPaymentSummaryDay,
  PosPaymentSummaryKey,
  PosPaymentSummaryResponse,
} from "@acropora/types";

/** One completed POS sale, as far as the summary reads it. */
export interface PosPaymentRow {
  createdAt: Date;
  paymentMethod: Exclude<PosPaymentSummaryKey, "UNKNOWN"> | null;
  totalGross: Prisma.Decimal;
}

/// Display order of the columns. CARD, CASH and CASH_DESK always show (the
/// shop reads these three every day); TRANSFER and UNKNOWN only when a sale
/// of that kind exists in the range.
const ALWAYS_SHOWN: PosPaymentSummaryKey[] = ["CARD", "CASH", "CASH_DESK"];
const WHEN_PRESENT: PosPaymentSummaryKey[] = ["TRANSFER", "UNKNOWN"];

const BUDAPEST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Budapest calendar day of an instant, `YYYY-MM-DD`. */
export function budapestDay(instant: Date): string {
  return BUDAPEST_DAY.format(instant);
}

/** Every `YYYY-MM-DD` from `from` to `to`, inclusive. Both must be valid days. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

interface Accumulator {
  count: number;
  totalGross: Prisma.Decimal;
}

function emptyAccumulator(): Accumulator {
  return { count: 0, totalGross: new Prisma.Decimal(0) };
}

function add(target: Accumulator, gross: Prisma.Decimal) {
  target.count += 1;
  target.totalGross = target.totalGross.plus(gross);
}

function toCell(accumulator: Accumulator): PosPaymentSummaryCell {
  return {
    count: accumulator.count,
    totalGross: accumulator.totalGross.toFixed(2),
  };
}

/**
 * Groups completed POS sales by Budapest day and payment method. Pure: the
 * rows come from the repository, the day boundaries are decided HERE, in
 * Budapest time, so a sale at 00:30 local counts on its own day in both the
 * summer and the winter offset.
 */
export function summarizePosPayments(
  from: string,
  to: string,
  rows: readonly PosPaymentRow[],
): PosPaymentSummaryResponse {
  const dayKeys = daysBetween(from, to);
  const perDay = new Map<
    string,
    {
      byMethod: Map<PosPaymentSummaryKey, Accumulator>;
      total: Accumulator;
    }
  >(
    dayKeys.map((day) => [
      day,
      { byMethod: new Map(), total: emptyAccumulator() },
    ]),
  );
  const totalsByMethod = new Map<PosPaymentSummaryKey, Accumulator>();
  const grandTotal = emptyAccumulator();

  for (const row of rows) {
    const day = perDay.get(budapestDay(row.createdAt));
    // Rows outside the requested days (the repository reads a padded range).
    if (!day) continue;
    const key: PosPaymentSummaryKey = row.paymentMethod ?? "UNKNOWN";
    const dayCell = day.byMethod.get(key) ?? emptyAccumulator();
    day.byMethod.set(key, dayCell);
    add(dayCell, row.totalGross);
    add(day.total, row.totalGross);
    const totalCell = totalsByMethod.get(key) ?? emptyAccumulator();
    totalsByMethod.set(key, totalCell);
    add(totalCell, row.totalGross);
    add(grandTotal, row.totalGross);
  }

  const methods = [
    ...ALWAYS_SHOWN,
    ...WHEN_PRESENT.filter((key) => totalsByMethod.has(key)),
  ];
  const cells = (byMethod: Map<PosPaymentSummaryKey, Accumulator>) =>
    Object.fromEntries(
      methods.map((key) => [
        key,
        toCell(byMethod.get(key) ?? emptyAccumulator()),
      ]),
    ) as PosPaymentSummaryDay["byMethod"];

  return {
    from,
    to,
    methods,
    days: dayKeys.map((date) => {
      const day = perDay.get(date)!;
      return { date, byMethod: cells(day.byMethod), total: toCell(day.total) };
    }),
    totals: { byMethod: cells(totalsByMethod), total: toCell(grandTotal) },
  };
}
