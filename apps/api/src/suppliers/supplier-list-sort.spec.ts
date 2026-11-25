import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SUPPLIER_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { SUPPLIER_LIST_SORT } from "./supplier-list-sort.js";

/**
 * A PARTNEREK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik (név
 * növekvő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a kért irányra; ha az ügyintéző üres értéke
 * valamelyik irányban nem a végére kerül (a Postgres csökkenőben az elejére tenné); ha a döntetlen-feloldó nem az irányt követi; ha egy
 * ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a partnerek listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: név növekvő, azonosító", () => {
    assert.deepEqual(listOrderBy(SUPPLIER_LIST_SORT, undefined, undefined), [
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("a kötelező mezők a SAJÁT mezőjükre rendeznek, a kért irányra, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...SUPPLIER_LIST_SORT_FIELDS].sort(), [
      "code",
      "contactPersonName",
      "country",
      "name",
    ]);
    for (const direction of ["asc", "desc"] as const)
      for (const field of ["code", "name", "country"] as const)
        assert.deepEqual(listOrderBy(SUPPLIER_LIST_SORT, field, direction), [
          { [field]: direction },
          { id: direction },
        ]);
  });

  it("az ügyintéző mindkét irányban az üres értékkel a végén rendez", () => {
    for (const direction of ["asc", "desc"] as const)
      assert.deepEqual(
        listOrderBy(SUPPLIER_LIST_SORT, "contactPersonName", direction),
        [
          { contactPersonName: { sort: direction, nulls: "last" } },
          { id: direction },
        ],
      );
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(SUPPLIER_LIST_SORT, "code", undefined)[0], {
      code: "asc",
    });
    for (const bad of ["email", "status", "constructor", "toString"])
      assert.deepEqual(
        listOrderBy(SUPPLIER_LIST_SORT, bad as never, "asc"),
        listOrderBy(SUPPLIER_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
