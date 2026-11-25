import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CUSTOMER_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { CUSTOMER_LIST_SORT } from "./customer-list-sort.js";

/**
 * A VEVŐK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (név
 * növekvő, azonosító); ha a név nem a saját mezőjére rendez, vagy nem a kért irányra; ha a döntetlen-feloldó nem az irányt követi; ha a
 * fehér lista bővül egy nem tárolt mezővel (partnerkód, cím, forrás); ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a vevők listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: név növekvő, azonosító", () => {
    assert.deepEqual(listOrderBy(CUSTOMER_LIST_SORT, undefined, undefined), [
      { displayName: "asc" },
      { id: "asc" },
    ]);
  });

  it("a fehér lista pontosan a név; a kért irányra rendez, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...CUSTOMER_LIST_SORT_FIELDS], ["displayName"]);
    for (const direction of ["asc", "desc"] as const)
      assert.deepEqual(
        listOrderBy(CUSTOMER_LIST_SORT, "displayName", direction),
        [{ displayName: direction }, { id: direction }],
      );
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(CUSTOMER_LIST_SORT, "displayName", undefined)[0],
      { displayName: "asc" },
    );
    for (const bad of ["partnerCode", "address", "source", "constructor"])
      assert.deepEqual(
        listOrderBy(CUSTOMER_LIST_SORT, bad as never, "asc"),
        listOrderBy(CUSTOMER_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
