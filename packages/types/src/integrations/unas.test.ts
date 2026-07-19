import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stageUnasProductRow, type UnasCategoryImportRow } from "./unas.js";

describe("UNAS catalog staging", () => {
  it("preserves an unknown externalStatus without semantic mapping", () => {
    const result = stageUnasProductRow({
      sourceRowNumber: 12,
      externalId: "unas-product-12",
      sku: "SKU-12",
      name: "Teszt termék",
      externalStatus: "3",
      rawPayload: { Status: "3" },
    });

    assert.equal(result.status, "VALID");
    assert.equal(result.row.externalStatus, "3");
    assert.equal(result.row.rawPayload.Status, "3");
  });

  it("reports invalid rows without discarding the raw payload", () => {
    const result = stageUnasProductRow({
      sourceRowNumber: 0,
      sku: "",
      name: " ",
      rawPayload: { original: true },
    });

    assert.equal(result.status, "INVALID");
    assert.equal(result.issues.length, 3);
    assert.deepEqual(result.row.rawPayload, { original: true });
  });

  it("provides a typed category staging contract", () => {
    const category: UnasCategoryImportRow = {
      sourceRowNumber: 4,
      externalId: "category-4",
      name: "Akváriumok",
      parentExternalId: "category-root",
      rawPayload: {},
    };
    assert.equal(category.parentExternalId, "category-root");
  });
});
