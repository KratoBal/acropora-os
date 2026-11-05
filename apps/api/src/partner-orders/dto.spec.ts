// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { PartnerOrderListQueryDto } from "./dto.js";

/**
 * A MEGRENDELESEK LISTAJANAK KERESE (S4, 38caeac2). MI PIROSIT: ha egy ismeretlen "hol tart" ertek atmegy (a szuro
 * csendben semmit nem szurne, vagy hibat dobna az adatbazisig); ha az `open` barmi mas lehetne az `1`-nel (a
 * "0" vagy "false" is bekapcsolna); ha a szuro nelkuli kerest elutasitja.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(PartnerOrderListQueryDto, query)).length > 0;

describe("PartnerOrderListQueryDto", () => {
  it("accepts the plain list and each chain stage", () => {
    assert.equal(hibas({}), false);
    for (const stage of [
      "NO_ORDER_FORM",
      "NO_COMPLETION",
      "AWAITING_SIGNATURE",
      "AWAITING_INVOICE",
      "INVOICED",
    ])
      assert.equal(hibas({ stage }), false, stage);
  });

  it("refuses a stage it does not know", () => {
    for (const stage of ["", "awaiting_invoice", "DONE", "1"])
      assert.equal(hibas({ stage }), true, stage);
  });

  it("takes only 1 for the open lines filter", () => {
    assert.equal(hibas({ open: "1" }), false);
    for (const open of ["0", "true", "yes", ""])
      assert.equal(hibas({ open }), true, open);
  });
});
