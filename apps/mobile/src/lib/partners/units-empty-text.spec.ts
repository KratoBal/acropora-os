import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { partnerUnitsEmptyText } from "./units-empty-text";

/** Kártya 227a2137: három ok, és a felület eddig mindet ugyanúgy mondta. */
describe("partnerUnitsEmptyText", () => {
  it("a hálózati üres lista ok nélkül: még nincs helyszín (ide esik a hatókörön kívüli partner is)", () => {
    assert.equal(
      partnerUnitsEmptyText({ fromCache: false }),
      "Ehhez a partnerhez még nincs felvéve helyszín.",
    );
  });

  it("a vevő-sorhoz nem kötött partner: irodai javítás, nem hiányzó helyszín", () => {
    const text = partnerUnitsEmptyText({
      fromCache: false,
      reason: "SUPPLIER_NOT_LINKED",
    });
    assert.match(text ?? "", /nincs vevővel összekötve/);
    assert.doesNotMatch(text ?? "", /még nincs felvéve/);
  });

  it("offline, mentett másolatból: nincs mondat, a mentett-másolat sáv beszél", () => {
    assert.equal(partnerUnitsEmptyText({ fromCache: true }), null);
    assert.equal(
      partnerUnitsEmptyText({ fromCache: true, reason: "SUPPLIER_NOT_LINKED" }),
      null,
    );
  });
});
