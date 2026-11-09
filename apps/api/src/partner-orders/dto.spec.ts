// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  PartnerOrderListQueryDto,
  UpdatePartnerOrderSettingsDto,
} from "./dto.js";

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

/*
  A MEGRENDELESEK BEALLITASA ES A HATRALEK SZURO (S4b). MI PIROSIT: ha a 0 napos kuszob elutasitodik (Luca: a 0 is
  ervenyes); ha negativ, tort, szoveges vagy 365 feletti ertek atmegy; ha a `backlog` barmi mas lehet az `1`-nel.
*/
const settingsHibas = (body: object) =>
  validateSync(plainToInstance(UpdatePartnerOrderSettingsDto, body)).length > 0;

describe("UpdatePartnerOrderSettingsDto", () => {
  it("takes zero and the whole days up to a year", () => {
    for (const backlogDays of [0, 1, 14, 365, "14"])
      assert.equal(settingsHibas({ backlogDays }), false, String(backlogDays));
  });

  it("refuses a negative, fractional, textual, empty or too large value", () => {
    for (const backlogDays of [-1, 14.5, "x", "", 366, null])
      assert.equal(settingsHibas({ backlogDays }), true, String(backlogDays));
    assert.equal(settingsHibas({}), true);
  });
});

describe("PartnerOrderListQueryDto backlog", () => {
  it("takes only 1", () => {
    assert.equal(hibas({ backlog: "1" }), false);
    for (const backlog of ["0", "true", ""])
      assert.equal(hibas({ backlog }), true, backlog);
  });
});
