import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MnbExchangeRateService } from "./mnb-exchange-rate.service.js";
import type { MnbDailyRate } from "./mnb-exchange-rate.client.js";

class FakeClient {
  constructor(private readonly rates: MnbDailyRate[]) {}
  async getExchangeRates(): Promise<MnbDailyRate[]> {
    return this.rates;
  }
}

describe("MnbExchangeRateService", () => {
  it("returns rate 1 for HUF without calling the client", async () => {
    const service = new MnbExchangeRateService(new FakeClient([]) as never);
    const result = await service.getRateForDate("huf", new Date("2026-07-20"));
    assert.deepEqual(result, { quotedDate: "2026-07-20", rate: "1" });
  });

  it("picks the latest quoted day at or before the requested date (weekend fallback)", async () => {
    // 2026-07-20 hétfő, de a kért nap 2026-07-19 (vasárnap) - nincs jegyzés,
    // a péntekit (07-17) kell visszaadnia.
    const service = new MnbExchangeRateService(
      new FakeClient([
        { date: "2026-07-16", rate: "401.50" },
        { date: "2026-07-17", rate: "401.90" },
      ]) as never,
    );
    const result = await service.getRateForDate("EUR", new Date("2026-07-19"));
    assert.deepEqual(result, { quotedDate: "2026-07-17", rate: "401.90" });
  });

  it("throws when no rate is available in the lookback window", async () => {
    const service = new MnbExchangeRateService(new FakeClient([]) as never);
    await assert.rejects(() => service.getRateForDate("EUR", new Date("2026-07-19")));
  });
});
