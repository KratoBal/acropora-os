import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PURCHASE_INVOICE_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { PURCHASE_INVOICE_SORT } from "./purchase-invoice-sort.js";

/**
 * A BESZERZÉSI SZÁMLÁK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (kelte csökkenő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez (a beszállító neve a kapcsolaton át), vagy nem a
 * kért irányra; ha a döntetlen-feloldó (az azonosító) nem az irányt követi; ha egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a beszerzési számlák rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: kelte csökkenő, azonosító", () => {
    assert.deepEqual(listOrderBy(PURCHASE_INVOICE_SORT, undefined, undefined), [
      { invoiceDate: "desc" },
      { id: "desc" },
    ]);
  });

  it("mindegyik fehér-listás mező a SAJÁT mezőjére rendez, a kért irányra; a beszállító neve a kapcsolaton át", () => {
    assert.deepEqual([...PURCHASE_INVOICE_SORT_FIELDS].sort(), [
      "documentNumber",
      "invoiceDate",
      "supplierInvoiceNumber",
      "supplierName",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(
        listOrderBy(PURCHASE_INVOICE_SORT, "supplierName", direction),
        [{ supplier: { name: direction } }, { id: direction }],
      );
      for (const field of [
        "documentNumber",
        "supplierInvoiceNumber",
        "invoiceDate",
      ] as const)
        assert.deepEqual(listOrderBy(PURCHASE_INVOICE_SORT, field, direction), [
          { [field]: direction },
          { id: direction },
        ]);
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(PURCHASE_INVOICE_SORT, "documentNumber", undefined)[0],
      { documentNumber: "asc" },
    );
    for (const bad of ["totalNet", "isPaid", "constructor", "toString"])
      assert.deepEqual(
        listOrderBy(PURCHASE_INVOICE_SORT, bad as never, "asc"),
        listOrderBy(PURCHASE_INVOICE_SORT, undefined, undefined),
        bad,
      );
  });
});
