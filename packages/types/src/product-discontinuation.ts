/**
 * THE MANUAL "PERMANENTLY DISCONTINUED" MARK OF A PRODUCT (V4.2, card 9d0523fa).
 *
 * A row means a person marked the product; there is no "false" state, un-marking deletes the row. A product
 * that is only out of stock for now is NOT this mark (that one is computed from the UNAS state and stays on
 * the "not available" page). The replacement is one product chosen by a person, never derived: a "similar"
 * relation given by hand in UNAS is not an approval (acrobot, 2026-11-14).
 */
export interface ProductDiscontinuationReplacement {
  id: string;
  name: string;
}

export interface ProductDiscontinuation {
  productId: string;
  /** The approved replacement, or `null`: then the shop sends the visitor to the product's category. */
  replacement: ProductDiscontinuationReplacement | null;
  /** When the mark (or its replacement) last changed, ISO 8601. */
  updatedAt: string;
}

/** The body of `PUT /products/:productId/discontinuation`: the whole state, so no field is "left as it was". */
export interface SetProductDiscontinuationInput {
  replacementProductId?: string | null;
}
