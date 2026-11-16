import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { ExchangeRateQueryDto } from "./exchange-rate-query.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): the exchange rate day.
describe("strict ISO dates: the exchange rate day", () => {
  it("ExchangeRateQueryDto: date", async () => {
    await assertStrictIsoDates(ExchangeRateQueryDto, ["date"]);
  });
});
