import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIMPLEPAY_REPORT_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../../common/list-sort.js";
import { REPORT_SORT } from "./simplepay-report-sort.js";

/**
 * A SIMPLEPAY-KIMUTATÁSOK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje
 * megváltozik (kimutatás napja csökkenő, létrehozás, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a
 * kért irányra; ha a döntetlen-feloldó nem az irányt követi; ha a kimutatás napja üres értéke valamelyik irányban nem a végére kerül
 * (a Postgres csökkenőben az elejére tenné); ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy a fehér listán.
 */
describe("a SimplePay-kimutatások rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: kimutatás napja csökkenő, létrehozás, azonosító", () => {
    assert.deepEqual(listOrderBy(REPORT_SORT, undefined, undefined), [
      { reportDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a számmezők a SAJÁT mezőjükre rendeznek, a kért irányra, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...SIMPLEPAY_REPORT_SORT_FIELDS].sort(), [
      "amountTotal",
      "commissionTotal",
      "netTotal",
      "reportDate",
    ]);
    for (const field of ["amountTotal", "commissionTotal", "netTotal"] as const)
      for (const direction of ["asc", "desc"] as const)
        assert.deepEqual(listOrderBy(REPORT_SORT, field, direction), [
          { [field]: direction },
          { createdAt: direction },
          { id: direction },
        ]);
  });

  it("a kimutatás napja mindkét irányban az üres értékkel a végén rendez", () => {
    for (const direction of ["asc", "desc"] as const)
      assert.deepEqual(listOrderBy(REPORT_SORT, "reportDate", direction), [
        { reportDate: { sort: direction, nulls: "last" } },
        { createdAt: direction },
        { id: direction },
      ]);
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(REPORT_SORT, "netTotal", undefined)[0], {
      netTotal: "asc",
    });
    for (const bad of ["status", "fileName", "constructor", "toString"])
      assert.deepEqual(
        listOrderBy(REPORT_SORT, bad as never, "asc"),
        listOrderBy(REPORT_SORT, undefined, undefined),
        bad,
      );
  });
});
