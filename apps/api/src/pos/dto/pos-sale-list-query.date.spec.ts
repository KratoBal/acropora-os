import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { PosSaleListQueryDto } from "./pos-sale-list-query.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): the sale list filter.
describe("strict ISO dates: the sale list filter", () => {
  it("PosSaleListQueryDto: createdFrom, createdTo", async () => {
    await assertStrictIsoDates(PosSaleListQueryDto, [
      "createdFrom",
      "createdTo",
    ]);
  });
});
