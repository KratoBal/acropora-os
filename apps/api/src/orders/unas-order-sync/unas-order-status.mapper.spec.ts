import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapUnasOrderStatus } from "./unas-order-status.mapper.js";

describe("mapUnasOrderStatus", () => {
  it("maps the four documented UNAS StatusType values", () => {
    assert.equal(mapUnasOrderStatus("open_normal"), "CONFIRMED");
    assert.equal(mapUnasOrderStatus("open_prepare"), "ON_HOLD");
    assert.equal(mapUnasOrderStatus("close_ok"), "COMPLETED");
    assert.equal(mapUnasOrderStatus("close_fault"), "CANCELLED");
  });

  it("defaults unknown or missing status types to CONFIRMED", () => {
    assert.equal(mapUnasOrderStatus(null), "CONFIRMED");
    assert.equal(mapUnasOrderStatus("something_shop_specific"), "CONFIRMED");
  });
});
