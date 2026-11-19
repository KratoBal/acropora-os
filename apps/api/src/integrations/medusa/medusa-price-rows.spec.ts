import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseRowsOf, isPriceListRow } from "./medusa-price-rows.js";

/*
  WHICH ROWS ARE THE BASE PRICE (card 54bb3779). WHAT TURNS RED: a row with a price list id counted as a base row (the first
  sale price list stops the variant: ambiguous-price); a row without the field, or with null, taken for a list row (a
  response that cannot tell would drop real base rows and the projection would create a second one); an empty id text
  taken for a list.
*/
describe("isPriceListRow", () => {
  it("is true only for a non-empty price list id", () => {
    assert.equal(isPriceListRow({ price_list_id: "plist_1" }), true);
    assert.equal(isPriceListRow({ price_list_id: null }), false);
    assert.equal(isPriceListRow({}), false);
    assert.equal(isPriceListRow({ price_list_id: "" }), false);
  });
});

describe("baseRowsOf", () => {
  it("keeps the base rows in their order and drops the list rows", () => {
    const rows = [
      { id: "a", price_list_id: null },
      { id: "s", price_list_id: "plist_1" },
      { id: "b" },
    ];
    assert.deepEqual(
      baseRowsOf(rows).map((row) => row.id),
      ["a", "b"],
    );
    assert.deepEqual(baseRowsOf([]), []);
  });
});
