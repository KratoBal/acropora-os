import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { materialRequestItemsText } from "./material-request-item-text.js";

describe("az anyagigény tételeinek levél-szövege", () => {
  it('egy tétel egy sor, "- név: mennyiség egység" alakban', () => {
    assert.equal(
      materialRequestItemsText([
        { name: "40mm könyök", quantity: "2", unit: "db" },
      ]),
      "- 40mm könyök: 2 db",
    );
  });

  it("több tétel, a felvitel sorrendjében, soronként", () => {
    assert.equal(
      materialRequestItemsText([
        { name: "40mm PVC nyomócső", quantity: "10", unit: "méter" },
        { name: "40mm 90 fokos könyök", quantity: "4", unit: "db" },
      ]),
      "- 40mm PVC nyomócső: 10 méter\n- 40mm 90 fokos könyök: 4 db",
    );
  });

  it("üres lista üres szöveg -- nem hibázik", () => {
    assert.equal(materialRequestItemsText([]), "");
  });

  it("a mennyiség szabad szöveg is lehet, betűre megy át", () => {
    /*
      Balazs kifejezett kerese: a mennyiseg mezobe "kb 10" is bemehet. A
      formazo nem ertelmezi, csak masolja -- ha valaha szamma probalna
      alakitani, ez az allitas piroslana.
    */
    assert.equal(
      materialRequestItemsText([
        { name: "Tömítés", quantity: "kb 10", unit: "db" },
      ]),
      "- Tömítés: kb 10 db",
    );
  });
});
