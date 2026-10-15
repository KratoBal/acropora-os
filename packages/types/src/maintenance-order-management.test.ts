import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenanceOrderSheetDocument,
  maintenanceOrderSourceLabel,
} from "./maintenance-order-management.js";

// A PORTÁL LETÖLTHETŐ MEGRENDELŐLAPJA A FORRÁST KÖVETI (karbantartási felmérés
// S8). MI PIROSÍT: ha a vevő megrendelőlapjánál a generált lapot keresné (és
// így letöltés nélkül maradna), ha egy generált lapnál a vevői vagy az aláírt
// példányt adná, vagy ha egy hiányzó dokumentum helyett mást adna vissza.
const generated = { id: "g", type: "GENERATED_FORM" as const };
const signed = { id: "s", type: "SIGNED_FORM" as const };
const customer = { id: "c", type: "CUSTOMER_FORM" as const };

describe("maintenanceOrderSheetDocument", () => {
  it("a vevő megrendelőlapjánál a feltöltött CUSTOMER_FORM dokumentum", () => {
    assert.equal(
      maintenanceOrderSheetDocument({
        source: "CUSTOMER_FORM",
        documents: [customer],
      }),
      customer,
    );
  });

  it("a generált lapnál a GENERATED_FORM, az aláírt példány mellett is", () => {
    assert.equal(
      maintenanceOrderSheetDocument({
        source: "GENERATED",
        documents: [signed, generated],
      }),
      generated,
    );
  });

  it("nincs csere a két forrás között: a hiány hiány marad", () => {
    assert.equal(
      maintenanceOrderSheetDocument({
        source: "CUSTOMER_FORM",
        documents: [generated, signed],
      }),
      undefined,
    );
    assert.equal(
      maintenanceOrderSheetDocument({
        source: "GENERATED",
        documents: [customer, signed],
      }),
      undefined,
    );
  });

  it("a vevői lap felirata ugyanaz, mint a belső szerződés-lapon", () => {
    assert.equal(
      maintenanceOrderSourceLabel.CUSTOMER_FORM,
      "Vevő megrendelőlapja",
    );
  });
});
