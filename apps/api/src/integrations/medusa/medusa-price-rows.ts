/**
 * WHICH PRICE ROWS OF A VARIANT ARE OURS TO SPEAK ABOUT: THE BASE ROWS (card 54bb3779, the sale price list's first
 * precondition).
 *
 * A variant's `prices` (`*prices`, remapped by the admin to the price set's prices) hold EVERY row of the price set, and a
 * sale price list's price is one of them (it carries a `price_list_id`). The OS writes and reads the variant's BASE price: the
 * row without a price list. Medusa's own write agrees: `updatePriceSets_` lists only the `price_list_id = null` rows as the
 * ones a whole-list write may delete (pricing-module.js), so a list row is never ours to replace or to count.
 *
 * WITHOUT THIS FILTER THE FIRST SALE PRICE LIST STOPS THE VARIANT: the projection counts two forint rows and refuses
 * (`ambiguous-price`), its read-back after a write finds two rows and refuses (`write-not-visible`), and the audit and the
 * repair read the list row as a duplicate or an unknown shape.
 *
 * A row is a list row ONLY when `price_list_id` is a non-empty text. `null` is a base row, and so is a missing field: a
 * response without the field cannot be told apart, and the audit's `unknown` shape (`priceRowKind`) names that case itself.
 */
export const isPriceListRow = (row: {
  price_list_id?: string | null;
}): boolean =>
  typeof row.price_list_id === "string" && row.price_list_id !== "";

export function baseRowsOf<T extends { price_list_id?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => !isPriceListRow(row));
}
