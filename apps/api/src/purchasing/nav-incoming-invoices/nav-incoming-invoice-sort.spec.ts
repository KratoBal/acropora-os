import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NAV_INCOMING_INVOICE_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../../common/list-sort.js";
import { NAV_INCOMING_INVOICE_SORT } from "./nav-incoming-invoice-sort.js";

/**
 * A NAV BEJÖVŐ SZÁMLÁK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (NAV beérkezési idő csökkenő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a kért irányra; ha a
 * teljesítés napja üres értéke valamelyik irányban nem a végére kerül (a Postgres csökkenőben az elejére tenné); ha a döntetlen-feloldó
 * nem az irányt követi; ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a NAV bejövő számlák rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: NAV beérkezési idő csökkenő, azonosító", () => {
    assert.deepEqual(
      listOrderBy(NAV_INCOMING_INVOICE_SORT, undefined, undefined),
      [{ insDate: "desc" }, { id: "desc" }],
    );
  });

  it("a kötelező mezők a SAJÁT mezőjükre rendeznek, a kért irányra, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...NAV_INCOMING_INVOICE_SORT_FIELDS].sort(), [
      "invoiceDeliveryDate",
      "invoiceIssueDate",
      "navInvoiceNumber",
      "supplierName",
    ]);
    for (const direction of ["asc", "desc"] as const)
      for (const field of [
        "navInvoiceNumber",
        "supplierName",
        "invoiceIssueDate",
      ] as const)
        assert.deepEqual(
          listOrderBy(NAV_INCOMING_INVOICE_SORT, field, direction),
          [{ [field]: direction }, { id: direction }],
        );
  });

  it("a teljesítés napja mindkét irányban az üres értékkel a végén rendez", () => {
    for (const direction of ["asc", "desc"] as const)
      assert.deepEqual(
        listOrderBy(
          NAV_INCOMING_INVOICE_SORT,
          "invoiceDeliveryDate",
          direction,
        ),
        [
          { invoiceDeliveryDate: { sort: direction, nulls: "last" } },
          { id: direction },
        ],
      );
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(NAV_INCOMING_INVOICE_SORT, "supplierName", undefined)[0],
      { supplierName: "asc" },
    );
    for (const bad of ["invoiceNetAmount", "status", "constructor", "toString"])
      assert.deepEqual(
        listOrderBy(NAV_INCOMING_INVOICE_SORT, bad as never, "asc"),
        listOrderBy(NAV_INCOMING_INVOICE_SORT, undefined, undefined),
        bad,
      );
  });
});
