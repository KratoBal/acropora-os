import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MORTALITY_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { MORTALITY_LIST_SORT } from "./mortality-list-sort.js";

/**
 * AZ ELHULLÁSI NAPLÓ RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (az elhullás
 * napja csökkenő, a rögzítés ideje, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez (a rögzítő a felhasználó
 * kapcsolaton át), vagy nem a kért irányra; ha a döntetlen-feloldók (a rögzítés ideje, majd az azonosító) nem az irányt követik; ha egy
 * ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("az elhullási napló rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: elhullás napja csökkenő, rögzítés ideje csökkenő, azonosító", () => {
    assert.deepEqual(listOrderBy(MORTALITY_LIST_SORT, undefined, undefined), [
      { occurredOn: "desc" },
      { recordedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a mezők a SAJÁT mezőjükre rendeznek, a kért irányra, a döntetlen-feloldók követik az irányt", () => {
    assert.deepEqual([...MORTALITY_LIST_SORT_FIELDS].sort(), [
      "occurredOn",
      "quantity",
      "recordedByName",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      const ties = [{ recordedAt: direction }, { id: direction }];
      assert.deepEqual(
        listOrderBy(MORTALITY_LIST_SORT, "quantity", direction),
        [{ quantity: direction }, ...ties],
      );
      assert.deepEqual(
        listOrderBy(MORTALITY_LIST_SORT, "occurredOn", direction),
        [{ occurredOn: direction }, ...ties],
      );
      assert.deepEqual(
        listOrderBy(MORTALITY_LIST_SORT, "recordedByName", direction),
        [{ recordedBy: { displayName: direction } }, ...ties],
      );
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(MORTALITY_LIST_SORT, "quantity", undefined)[0],
      { quantity: "asc" },
    );
    for (const bad of ["productName", "sourceType", "constructor"])
      assert.deepEqual(
        listOrderBy(MORTALITY_LIST_SORT, bad as never, "asc"),
        listOrderBy(MORTALITY_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
