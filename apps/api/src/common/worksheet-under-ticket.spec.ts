import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mayWorksheetJoinTicket } from "./worksheet-under-ticket.js";

describe("fogadhatja-e a hibajegy ezt a munkalapot", () => {
  it("egyező partnernél átengedi", () => {
    assert.deepEqual(
      mayWorksheetJoinTicket({
        ticketCustomerId: "cust-1",
        worksheetCustomerId: "cust-1",
      }),
      { ok: true },
    );
  });

  /**
   * A KET ELUTASITAS KULON NEVET KAP, ES EZ AZ ALLITAS EPP AZT ORZI.
   *
   * A ket eset TEENDOJE mas: partner nelkuli jegynel a partnert kell
   * beallitani, elteronel masik lapot kell valasztani. Egy kozos "nem lehet"
   * mindket felhasznalot rossz iranyba kuldene -- es egy allitas, ami csak az
   * `ok: false` erteket nezi, nem venne eszre, ha a ketto osszecsuszna.
   */
  it("partner nélküli jegyet külön névvel utasít el", () => {
    assert.deepEqual(
      mayWorksheetJoinTicket({
        ticketCustomerId: null,
        worksheetCustomerId: "cust-1",
      }),
      { ok: false, reason: "ticket-has-no-partner" },
    );
  });

  it("eltérő partnert külön névvel utasít el", () => {
    assert.deepEqual(
      mayWorksheetJoinTicket({
        ticketCustomerId: "cust-1",
        worksheetCustomerId: "cust-2",
      }),
      { ok: false, reason: "other-partner" },
    );
  });
});
