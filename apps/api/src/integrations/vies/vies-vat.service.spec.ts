import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ViesApiError, type ViesVatCheckResult } from "./vies-vat.client.js";
import { ViesVatService } from "./vies-vat.service.js";

class FakeClient {
  constructor(
    private readonly result: ViesVatCheckResult | Error,
    readonly calls: Array<[string, string]> = [],
  ) {}
  async checkVat(
    countryCode: string,
    vatNumber: string,
  ): Promise<ViesVatCheckResult> {
    this.calls.push([countryCode, vatNumber]);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("ViesVatService", () => {
  it("returns a format-error message without calling the client for a non-EU-shaped tax number", async () => {
    const client = new FakeClient({ valid: true });
    const service = new ViesVatService(client as never);
    const result = await service.check("12345678-1-42");
    assert.equal(result.valid, undefined);
    assert.match(result.message ?? "", /formátum/);
    assert.deepEqual(client.calls, []);
  });

  it("splits the country prefix from the number and calls the client", async () => {
    const client = new FakeClient({ valid: true, name: "Example GmbH" });
    const service = new ViesVatService(client as never);
    const result = await service.check("DE 206223519");
    assert.equal(result.valid, true);
    assert.equal(result.name, "Example GmbH");
    assert.deepEqual(client.calls, [["DE", "206223519"]]);
  });

  it("returns valid: false when VIES reports the VAT number as invalid", async () => {
    const client = new FakeClient({ valid: false });
    const service = new ViesVatService(client as never);
    const result = await service.check("DE206223511");
    assert.equal(result.valid, false);
  });

  it("maps a client error to a Hungarian message instead of throwing", async () => {
    const client = new FakeClient(new ViesApiError("MS_UNAVAILABLE"));
    const service = new ViesVatService(client as never);
    const result = await service.check("FR12345678901");
    assert.equal(result.valid, undefined);
    assert.match(result.message ?? "", /tagállam/);
  });
});
