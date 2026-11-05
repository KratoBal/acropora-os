import { Prisma } from "@acropora/database";

/**
 * HOW MANY OF AN ORDER'S LINES STILL HAVE A QUANTITY NO COMPLETION CERTIFICATE STATES (S4, card 38caeac2).
 *
 * The same arithmetic as the certificate plan's `remainingByItem` (the order's quantity minus the certified
 * lines', per quote item), counted instead of listed: a line is open while something is left, and a line certified
 * beyond its quantity is not open (the gate does not allow that; the count never goes negative or counts it).
 * The decimal quantities travel as text, so the comparison is exact, never a float.
 */
export function openLineCount(
  lines: readonly { quoteItemId: string; quantity: string }[],
  certified: readonly {
    quoteItemId: string;
    quantity: Prisma.Decimal | string;
  }[],
): number {
  const left = new Map(
    lines.map((line) => [line.quoteItemId, new Prisma.Decimal(line.quantity)]),
  );
  for (const line of certified) {
    const current = left.get(line.quoteItemId);
    if (current !== undefined)
      left.set(line.quoteItemId, current.minus(line.quantity));
  }
  return [...left.values()].filter((value) => value.greaterThan(0)).length;
}
