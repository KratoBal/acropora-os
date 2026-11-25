import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INVENTORY_COUNT_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { INVENTORY_COUNT_SORT } from "./inventory-count-list-sort.js";

/**
 * A LELTÁRLISTA RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (létrehozás
 * csökkenő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez (a raktár a kapcsolaton át, a tételek a kapcsolat
 * darabszámán); ha a döntetlen-feloldó nem az irányt követi; ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a leltárlista rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: létrehozás csökkenő, azonosító", () => {
    assert.deepEqual(listOrderBy(INVENTORY_COUNT_SORT, undefined, undefined), [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a mezők a SAJÁT mezőjükre rendeznek, a kért irányra; a raktár a kapcsolaton át, a tételek a darabszámon", () => {
    assert.deepEqual([...INVENTORY_COUNT_SORT_FIELDS].sort(), [
      "countNumber",
      "createdAt",
      "lineCount",
      "warehouseName",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      const tie = { id: direction };
      assert.deepEqual(
        listOrderBy(INVENTORY_COUNT_SORT, "countNumber", direction),
        [{ countNumber: direction }, tie],
      );
      assert.deepEqual(
        listOrderBy(INVENTORY_COUNT_SORT, "warehouseName", direction),
        [{ warehouse: { name: direction } }, tie],
      );
      assert.deepEqual(
        listOrderBy(INVENTORY_COUNT_SORT, "createdAt", direction),
        [{ createdAt: direction }, tie],
      );
      assert.deepEqual(
        listOrderBy(INVENTORY_COUNT_SORT, "lineCount", direction),
        [{ lines: { _count: direction } }, tie],
      );
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(INVENTORY_COUNT_SORT, "countNumber", undefined)[0],
      { countNumber: "asc" },
    );
    for (const bad of ["status", "startedByName", "constructor"])
      assert.deepEqual(
        listOrderBy(INVENTORY_COUNT_SORT, bad as never, "asc"),
        listOrderBy(INVENTORY_COUNT_SORT, undefined, undefined),
        bad,
      );
  });
});
