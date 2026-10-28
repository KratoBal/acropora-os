import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { controlWhere } from "./billing-issuing-resolution.repository.js";

/**
 * A POZITÍV KONTROLL ALANYÁNAK SZŰRŐJE (barracuda, #1961). Mi pirosít: a
 * dokumentumtípus kiesik a szűrőből (egy számla igazolná a beragadt díjbekérő
 * "nincs ilyen azonosító" válaszát); nem csak kiállított, saját, számmal bíró
 * sort kér.
 */
describe("controlWhere", () => {
  it("a bizonylat típusára szűr, kiállított saját sort kér, számmal", () => {
    const where = controlWhere("PROFORMA");
    assert.equal(where.documentType, "PROFORMA");
    assert.equal(where.status, "ISSUED");
    assert.equal(where.direction, "OUTBOUND");
    assert.equal(where.source, "SZAMLAZZ");
    assert.deepEqual(where.invoiceNumber, { not: null });
  });

  it("két típus két külön szűrő", () => {
    assert.notDeepEqual(controlWhere("INVOICE"), controlWhere("PROFORMA"));
  });
});
