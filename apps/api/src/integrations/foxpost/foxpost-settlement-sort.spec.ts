import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FOXPOST_SETTLEMENT_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../../common/list-sort.js";
import { SETTLEMENT_SORT } from "./foxpost-settlement-sort.js";

/**
 * A FOXPOST-ELSZÁMOLÁSOK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje
 * megváltozik (számla kelte csökkenő az üres értékkel a végén, létrehozás, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére
 * rendez, vagy nem a kért irányra; ha valamelyik üres értékű oszlop valamelyik irányban nem az üres értékkel a végén rendez (a Postgres
 * csökkenőben az elejére tenné); ha a döntetlen-feloldó nem az irányt követi; ha egy ismeretlen vagy öröklött kulcs (`constructor`)
 * átmegy a fehér listán.
 */
describe("a Foxpost-elszámolások rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: számla kelte csökkenő (üres a végén), létrehozás, azonosító", () => {
    assert.deepEqual(listOrderBy(SETTLEMENT_SORT, undefined, undefined), [
      { invoiceIssueDate: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("mindegyik fehér-listás mező a SAJÁT mezőjére rendez, az üres értékkel a végén, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...FOXPOST_SETTLEMENT_SORT_FIELDS].sort(), [
      "collectedAmount",
      "invoiceIssueDate",
      "settlementCode",
      "transferredAmount",
    ]);
    for (const field of FOXPOST_SETTLEMENT_SORT_FIELDS)
      for (const direction of ["asc", "desc"] as const)
        assert.deepEqual(listOrderBy(SETTLEMENT_SORT, field, direction), [
          { [field]: { sort: direction, nulls: "last" } },
          { createdAt: direction },
          { id: direction },
        ]);
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(SETTLEMENT_SORT, "settlementCode", undefined)[0],
      { settlementCode: { sort: "asc", nulls: "last" } },
    );
    for (const bad of ["status", "invoiceNumber", "constructor", "toString"])
      assert.deepEqual(
        listOrderBy(SETTLEMENT_SORT, bad as never, "asc"),
        listOrderBy(SETTLEMENT_SORT, undefined, undefined),
        bad,
      );
  });
});
