import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listOrderBy, type ListSortSpec } from "./list-sort.js";

/**
 * A KÖZÖS RENDEZÉSI SEGÉD. Mi pirosít: ha egy fehér listán kívüli mező (a kérés szövege) az `orderBy`-ba kerül; ha az alapérték
 * nem a lista mostani sorrendje; ha az irány nem érvényesül; ha nincs döntetlen-feloldó; ha egy relációs oszlop saját `orderBy`-a
 * nem megy át.
 */
type OrderBy = Record<string, unknown>;
const spec: ListSortSpec<"createdAt" | "partner", OrderBy> = {
  fields: {
    createdAt: (direction) => ({ createdAt: direction }),
    partner: (direction) => ({ customer: { displayName: direction } }),
  },
  fallback: [{ updatedAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};

describe("listOrderBy", () => {
  it("keeps the list's own order without a sort", () => {
    assert.deepEqual(listOrderBy(spec, undefined, undefined), [
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
    assert.deepEqual(listOrderBy(spec, undefined, "asc"), [
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("sorts by the whitelisted field and direction, the id breaking ties the same way", () => {
    assert.deepEqual(listOrderBy(spec, "createdAt", "desc"), [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    assert.deepEqual(listOrderBy(spec, "createdAt", undefined), [
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("a relational column brings its own orderBy", () => {
    assert.deepEqual(listOrderBy(spec, "partner", "asc"), [
      { customer: { displayName: "asc" } },
      { id: "asc" },
    ]);
  });

  it("never lets a field outside the whitelist into the orderBy, not even an object key like constructor", () => {
    for (const bad of ["password", "constructor", "__proto__", "toString"])
      assert.deepEqual(
        listOrderBy(spec, bad as "createdAt", "asc"),
        [{ updatedAt: "desc" }, { id: "desc" }],
        bad,
      );
  });
});
