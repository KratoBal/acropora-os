import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BRAND_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { BRAND_LIST_SORT } from "./brand-list-sort.js";

/**
 * A MÁRKÁK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (név
 * növekvő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez (a termékek a kapcsolat darabszámán); ha a
 * döntetlen-feloldó nem az irányt követi; ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a márkák listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: név növekvő, azonosító", () => {
    assert.deepEqual(listOrderBy(BRAND_LIST_SORT, undefined, undefined), [
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("a mezők a SAJÁT mezőjükre rendeznek, a kért irányra; a termékek a kapcsolat darabszámán", () => {
    assert.deepEqual([...BRAND_LIST_SORT_FIELDS].sort(), [
      "name",
      "productCount",
      "updatedAt",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      const tie = { id: direction };
      assert.deepEqual(listOrderBy(BRAND_LIST_SORT, "name", direction), [
        { name: direction },
        tie,
      ]);
      assert.deepEqual(
        listOrderBy(BRAND_LIST_SORT, "productCount", direction),
        [{ products: { _count: direction } }, tie],
      );
      assert.deepEqual(listOrderBy(BRAND_LIST_SORT, "updatedAt", direction), [
        { updatedAt: direction },
        tie,
      ]);
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(BRAND_LIST_SORT, "name", undefined)[0], {
      name: "asc",
    });
    for (const bad of ["slug", "isActive", "aliases", "constructor"])
      assert.deepEqual(
        listOrderBy(BRAND_LIST_SORT, bad as never, "asc"),
        listOrderBy(BRAND_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
