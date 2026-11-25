// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { PurchaseInvoiceListQueryDto } from "./purchase-invoice-list-query.dto.js";

/**
 * A BESZERZÉSI SZÁMLÁK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad; ha a
 * fehér listán kívüli mező (az összeg, a fizetve jelző, egy kitalált név) vagy irány átmegy; ha a rendezés megadása nélkül a kérés
 * érvénytelen.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(PurchaseInvoiceListQueryDto, query)).length > 0;

describe("PurchaseInvoiceListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja, és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of [
      "documentNumber",
      "supplierName",
      "supplierInvoiceNumber",
      "invoiceDate",
    ])
      for (const direction of ["asc", "desc"])
        assert.equal(hibas({ sort, direction }), false, `${sort} ${direction}`);
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of [
      "totalNet",
      "isPaid",
      "source",
      "id",
      "constructor",
      "",
    ])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
