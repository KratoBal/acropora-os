import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serviceJobSource } from "./service-job-source.js";

const contract = { id: "c1", number: "SZ-2026-001", title: "Karbantartás" };

describe("serviceJobSource", () => {
  it("az aláírt megrendelőlap a forrás, akkor is, ha a lapon szerződéstételek is állnak", () => {
    assert.deepEqual(
      serviceJobSource({
        contract,
        maintenanceOrder: {
          id: "o1",
          number: "MR-2026-0007",
          source: "GENERATED",
        },
        contractItems: [{ description: "Szűrőcsere" }],
      }),
      {
        kind: "MAINTENANCE_ORDER",
        orderId: "o1",
        orderNumber: "MR-2026-0007",
        customerForm: false,
        contract,
      },
    );
  });

  it("a vevő saját megrendelőlapja jelölve jön", () => {
    const source = serviceJobSource({
      contract,
      maintenanceOrder: {
        id: "o2",
        number: "MR-2026-0008",
        source: "CUSTOMER_FORM",
      },
      contractItems: [],
    });
    assert.equal(source?.kind, "MAINTENANCE_ORDER");
    assert.equal(
      source?.kind === "MAINTENANCE_ORDER" && source.customerForm,
      true,
    );
  });

  it("megrendelőlap nélkül a szerződés és a lapon rögzített tételek a forrás, sorrendben", () => {
    assert.deepEqual(
      serviceJobSource({
        contract,
        maintenanceOrder: null,
        contractItems: [
          { description: "Szűrőcsere" },
          { description: "Vízcsere" },
        ],
      }),
      {
        kind: "CONTRACT",
        contract,
        itemDescriptions: ["Szűrőcsere", "Vízcsere"],
      },
    );
  });

  it("a tételek nélküli szerződéses lap is szerződéses forrás, üres tétellistával", () => {
    assert.deepEqual(
      serviceJobSource({ contract, maintenanceOrder: null, contractItems: [] }),
      { kind: "CONTRACT", contract, itemDescriptions: [] },
    );
  });

  it("szerződés és megrendelőlap nélkül nincs forrás", () => {
    assert.equal(
      serviceJobSource({
        contract: null,
        maintenanceOrder: null,
        contractItems: [],
      }),
      null,
    );
  });
});
