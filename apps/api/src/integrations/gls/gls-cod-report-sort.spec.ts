import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GLS_COD_REPORT_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../../common/list-sort.js";
import { COD_REPORT_SORT } from "./gls-cod-report-sort.js";

/**
 * A GLS-UTÁNVÉT LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (utalás napja csökkenő, létrehozás, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a kért irányra; ha
 * a döntetlen-feloldó nem az irányt követi (lapozáskor egy azonos napú sor vándorolna); ha a fehér lista mezője hiányzik a térképből;
 * ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy a fehér listán.
 */
describe("a GLS-utánvét lista rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: utalás napja csökkenő, létrehozás, azonosító", () => {
    assert.deepEqual(listOrderBy(COD_REPORT_SORT, undefined, undefined), [
      { transferDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("mindegyik fehér-listás mező a SAJÁT mezőjére rendez, a kért irányra, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...GLS_COD_REPORT_SORT_FIELDS].sort(), [
      "fileName",
      "total",
      "transferDate",
    ]);
    for (const field of GLS_COD_REPORT_SORT_FIELDS) {
      for (const direction of ["asc", "desc"] as const) {
        assert.deepEqual(listOrderBy(COD_REPORT_SORT, field, direction), [
          { [field]: direction },
          { createdAt: direction },
          { id: direction },
        ]);
      }
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(COD_REPORT_SORT, "total", undefined)[0], {
      total: "asc",
    });
    for (const bad of ["status", "constructor", "toString"]) {
      assert.deepEqual(
        listOrderBy(COD_REPORT_SORT, bad as never, "asc"),
        listOrderBy(COD_REPORT_SORT, undefined, undefined),
        bad,
      );
    }
  });
});
