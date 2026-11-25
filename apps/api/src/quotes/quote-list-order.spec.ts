import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QUOTE_SORT_FIELDS, quoteListOrderBy } from "./quote-list-order.js";

/**
 * AZ ÁRAJÁNLAT-LISTA RENDEZÉSE. Mi pirosít: ha az alapérték nem a legutóbb módosított elöl (ahogy eddig); ha a megadott mező vagy
 * irány nem érvényesül; ha nincs `id` döntetlen-feloldó (lapozáskor cserélgetné az azonos értékű sorokat); ha a fehér lista
 * mezőinek valamelyike nem rendezhető.
 */
describe("quoteListOrderBy", () => {
  it("defaults to the most recently modified first, as before", () => {
    assert.deepEqual(quoteListOrderBy({}), [
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("sorts by the asked field and direction, with the id breaking ties the same way", () => {
    assert.deepEqual(
      quoteListOrderBy({ sort: "createdAt", direction: "asc" }),
      [{ createdAt: "asc" }, { id: "asc" }],
    );
    assert.deepEqual(
      quoteListOrderBy({ sort: "quoteNumber", direction: "desc" }),
      [{ quoteNumber: "desc" }, { id: "desc" }],
    );
  });

  it("every whitelisted field produces a sort on that field, ascending when no direction is given (as the first click does)", () => {
    for (const field of QUOTE_SORT_FIELDS)
      assert.deepEqual(quoteListOrderBy({ sort: field })[0], {
        [field]: "asc",
      });
  });
});
