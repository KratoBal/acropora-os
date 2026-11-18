import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebshopCustomerDiscountInput } from "./webshop-customer-discounts.js";

/* A VEVŐNKÉNTI KEDVEZMÉNY BEMENETE (kártya 20713f62). MI PIROSÍT: egy nem webshop-vevő azonosító vagy egy rossz százalék átjut. */
describe("parseWebshopCustomerDiscountInput", () => {
  it("accepts a webshop customer and a whole percent", () => {
    assert.deepEqual(
      parseWebshopCustomerDiscountInput({
        customerId: " cus_01ABCDEF12 ",
        percent: 5,
      }),
      {
        ok: true,
        value: { customerId: "cus_01ABCDEF12", percent: 5 },
      },
    );
  });
  it("refuses another id, and a percent outside 1-100 or not whole", () => {
    for (const [over, field] of [
      [{ customerId: "" }, "customerId"],
      [{ customerId: "user_1234567890" }, "customerId"],
      // a lower-case id would not come back the same from the upper-cased promotion code
      [{ customerId: "cus_01abcdef12" }, "customerId"],
      [{ percent: 0 }, "percent"],
      [{ percent: 101 }, "percent"],
      [{ percent: 2.5 }, "percent"],
    ] as const) {
      const parsed = parseWebshopCustomerDiscountInput({
        customerId: "cus_01ABCDEF12",
        percent: 5,
        ...over,
      });
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.ok(parsed.errors[field], JSON.stringify(over));
    }
  });
});
