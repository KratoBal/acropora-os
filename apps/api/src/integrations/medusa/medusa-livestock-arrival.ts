/**
 * THE ARRIVAL A PRODUCT'S PAGE MAY SHOW (V2.6 S3a, card f4e4832b): the pure rule, no database, so its words can fail by name.
 *
 * WHICH ARRIVAL: among the product's arrivals, only one a customer may register for (`preorderable`) that has not arrived and
 * is not cancelled (`ORDERED`, `IN_TRANSIT`). The soonest day wins, the id breaks a tie, so the same rows always give the same
 * text and the projection does not rewrite an unchanged key. None qualifies: `null`, and the merge takes the key off the shop.
 *
 * WHAT GOES OUT, and nothing else: the day and the stage. The note is internal and never leaves; the label, the quantity and
 * the kind are not what the product page says (the product has its own name, and a count of animals is not a promise to a
 * customer). The shape is a versioned contract with the storefront (`v`), so a change of shape is a new version, not a
 * surprise on the page.
 *
 * THE DAY IS NOT COMPARED WITH TODAY, ON PURPOSE. The projection's due signal is the input tables' timestamps; a day that
 * passes moves no row, so a rule that dropped an overdue arrival would only drop it at the next unrelated projection, an
 * arbitrary moment. The shop reads the day and decides how to word a day that is already past (an arrival that slips is the
 * staff's edit, and that edit moves the row and re-projects).
 */
export type ProjectedArrivalRow = {
  id: string;
  /** a `@db.Date` column: midnight UTC of the day */
  expectedOn: Date;
  status: string;
  /** rows that are not preorderable are filtered here too, so the rule does not depend on the query */
  preorderable?: boolean;
};

export const LIVESTOCK_ARRIVAL_VERSION = 1;

const STAGES: Readonly<Record<string, "ordered" | "in_transit">> = {
  ORDERED: "ordered",
  IN_TRANSIT: "in_transit",
};

const day = (value: Date): string => value.toISOString().slice(0, 10);

/** The key's value for a product, or `null` when no arrival qualifies. */
export function livestockArrivalMetadata(
  rows: readonly ProjectedArrivalRow[] | null | undefined,
): string | null {
  const candidates = (rows ?? []).filter(
    (row) =>
      row.preorderable !== false &&
      row.status in STAGES &&
      !Number.isNaN(row.expectedOn.getTime()),
  );
  if (candidates.length === 0) return null;
  const next = [...candidates].sort(
    (a, b) =>
      a.expectedOn.getTime() - b.expectedOn.getTime() ||
      a.id.localeCompare(b.id),
  )[0]!;
  // a fixed key order: the same arrival is the same text
  return JSON.stringify({
    v: LIVESTOCK_ARRIVAL_VERSION,
    expected_on: day(next.expectedOn),
    status: STAGES[next.status],
  });
}
