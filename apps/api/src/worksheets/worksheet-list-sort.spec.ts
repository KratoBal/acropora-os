import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORKSHEET_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { WORKSHEET_LIST_SORT } from "./worksheet-list-sort.js";

/**
 * A MUNKALAPOK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (utolsó
 * módosítás csökkenő, azonosító); ha a partner oszlop nem a partner táblán át, a megnyitás nem a saját mezőjére rendez, vagy nem a kért
 * irányra; ha a döntetlen-feloldó nem az irányt követi; ha a fehér lista bővül egy nem tárolt mezővel (tárgy, állapot, munkaóra); ha egy
 * ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a munkalapok listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: utolsó módosítás csökkenő, azonosító", () => {
    assert.deepEqual(listOrderBy(WORKSHEET_LIST_SORT, undefined, undefined), [
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a fehér lista pontosan a két tárolt oszlop; a partner a kapcsolaton át, a megnyitás a saját mezőn", () => {
    assert.deepEqual([...WORKSHEET_LIST_SORT_FIELDS].sort(), [
      "createdAt",
      "customerName",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(
        listOrderBy(WORKSHEET_LIST_SORT, "customerName", direction),
        [{ customer: { displayName: direction } }, { id: direction }],
      );
      assert.deepEqual(
        listOrderBy(WORKSHEET_LIST_SORT, "createdAt", direction),
        [{ createdAt: direction }, { id: direction }],
      );
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(WORKSHEET_LIST_SORT, "createdAt", undefined)[0],
      { createdAt: "asc" },
    );
    for (const bad of ["subject", "status", "totalHours", "constructor"])
      assert.deepEqual(
        listOrderBy(WORKSHEET_LIST_SORT, bad as never, "asc"),
        listOrderBy(WORKSHEET_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
