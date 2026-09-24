import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextMaintenanceOrderNumber } from "./maintenance-order-number.js";

describe("a megrendelőlap száma", () => {
  it("az év első jegye 001", () => {
    assert.equal(
      nextMaintenanceOrderNumber({ year: 2026, lastNumber: null }),
      "MR-2026-001",
    );
  });

  it("a következő eggyel több, azonos hosszon", () => {
    assert.equal(
      nextMaintenanceOrderNumber({ year: 2026, lastNumber: "MR-2026-009" }),
      "MR-2026-010",
    );
  });

  it("a százas határon sem veszít jegyet", () => {
    assert.equal(
      nextMaintenanceOrderNumber({ year: 2026, lastNumber: "MR-2026-099" }),
      "MR-2026-100",
    );
    assert.equal(
      nextMaintenanceOrderNumber({ year: 2026, lastNumber: "MR-2026-999" }),
      "MR-2026-1000",
    );
  });

  it("nem értelmezhető előzménynél dob, nem kezd újra", () => {
    assert.throws(() =>
      nextMaintenanceOrderNumber({ year: 2026, lastNumber: "MR-2026-XYZ" }),
    );
  });
});
