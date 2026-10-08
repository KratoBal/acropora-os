import { Prisma } from "@acropora/database";

/**
 * A MILESTONE'S PROFORMA, SPLIT BY VAT RATE (#1582 P7, plan C10), a pure
 * function. The 40% is not taken of the gross total but per VAT rate, so the
 * proforma and the later advance invoice carry the right tax split:
 *
 *   a rate's line   = percent × the accepted lines' net on that rate,
 *                     down to whole forints;
 *   the total       = percent × the whole net, rounded to whole forints;
 *   the remainder   = total − the lines' sum, all of it on ONE line: the rate
 *                     with the largest net (then the higher rate).
 *
 * So the lines always add up to the rounded total, and no line is off by
 * more than the remainder. The VAT itself is the billing's own line
 * computation.
 *
 * A RATE WHOSE NET IS NEGATIVE (a discount line on a rate with nothing else,
 * barracuda's #1634 review) is named in `negativeRates`, and the caller
 * refuses: rounded toward zero and dropped, it would leave the lines above
 * the total (1000 Ft at 27%, −200 Ft at 5%, 40%: total 320 Ft, lines 400 Ft).
 */

export interface ProformaSourceLine {
  /** quantity × unit net price, exact */
  net: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
}

export interface ProformaRateLine {
  /** decimal text, e.g. "27" */
  vatRatePercent: string;
  /** whole forints, decimal text */
  net: string;
}

const ZERO = new Prisma.Decimal(0);

export function allocateMilestone(
  lines: readonly ProformaSourceLine[],
  percent: Prisma.Decimal,
): { lines: ProformaRateLine[]; total: string; negativeRates: string[] } {
  const ratio = percent.dividedBy(100);
  const bases = new Map<
    string,
    { rate: Prisma.Decimal; net: Prisma.Decimal }
  >();
  for (const line of lines) {
    const key = line.vatRatePercent.toString();
    const seen = bases.get(key);
    bases.set(key, {
      rate: line.vatRatePercent,
      net: (seen?.net ?? ZERO).plus(line.net),
    });
  }
  const total = ratio
    .times([...bases.values()].reduce((sum, b) => sum.plus(b.net), ZERO))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  const rates = [...bases.values()].sort(
    (a, b) => b.net.comparedTo(a.net) || b.rate.comparedTo(a.rate),
  );
  const amounts = rates.map((b) =>
    ratio.times(b.net).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN),
  );
  const remainder = total.minus(amounts.reduce((sum, a) => sum.plus(a), ZERO));
  if (amounts.length) amounts[0] = amounts[0]!.plus(remainder);

  return {
    lines: rates
      .map((b, i) => ({
        vatRatePercent: b.rate.toString(),
        net: amounts[i]!.toString(),
      }))
      // a rate with no net, or one whose share rounds down to nothing,
      // gives no line (its remainder is already on the largest rate)
      .filter((l) => new Prisma.Decimal(l.net).greaterThan(0))
      // the proforma reads best from the highest rate down
      .sort((a, b) =>
        new Prisma.Decimal(b.vatRatePercent).comparedTo(
          new Prisma.Decimal(a.vatRatePercent),
        ),
      ),
    total: total.toString(),
    negativeRates: [...bases.values()]
      .filter((b) => b.net.lessThan(0))
      .map((b) => b.rate.toString()),
  };
}
