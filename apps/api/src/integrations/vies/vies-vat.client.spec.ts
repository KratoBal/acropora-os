import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseViesResponseBody, ViesApiError } from "./vies-vat.client.js";

describe("parseViesResponseBody", () => {
  it("parses a valid VAT result with name and address", () => {
    const result = parseViesResponseBody(
      JSON.stringify({
        countryCode: "DE",
        vatNumber: "206223519",
        requestDate: "2026-07-24T10:00:00.000Z",
        valid: true,
        name: "Example GmbH",
        address: "Musterstrasse 1, Berlin",
      }),
    );
    assert.deepEqual(result, {
      valid: true,
      name: "Example GmbH",
      address: "Musterstrasse 1, Berlin",
      requestDate: "2026-07-24T10:00:00.000Z",
    });
  });

  it("parses an invalid VAT result", () => {
    const result = parseViesResponseBody(
      JSON.stringify({
        countryCode: "DE",
        vatNumber: "206223511",
        valid: false,
      }),
    );
    assert.equal(result.valid, false);
  });

  it("treats the VIES '---' placeholder as missing name/address", () => {
    const result = parseViesResponseBody(
      JSON.stringify({
        countryCode: "FR",
        vatNumber: "12345678901",
        valid: true,
        name: "---",
        address: "---",
      }),
    );
    assert.equal(result.name, undefined);
    assert.equal(result.address, undefined);
  });

  it("maps a userError fault code to a ViesApiError", () => {
    assert.throws(
      () =>
        parseViesResponseBody(JSON.stringify({ userError: "MS_UNAVAILABLE" })),
      (error: unknown) =>
        error instanceof ViesApiError && error.code === "MS_UNAVAILABLE",
    );
  });

  it("maps an unrecognized fault code to SERVICE_UNAVAILABLE", () => {
    assert.throws(
      () =>
        parseViesResponseBody(JSON.stringify({ userError: "SOMETHING_NEW" })),
      (error: unknown) =>
        error instanceof ViesApiError && error.code === "SERVICE_UNAVAILABLE",
    );
  });

  it("throws RESPONSE_INVALID for malformed JSON", () => {
    assert.throws(
      () => parseViesResponseBody("not json"),
      (error: unknown) =>
        error instanceof ViesApiError && error.code === "RESPONSE_INVALID",
    );
  });

  it("throws RESPONSE_INVALID when 'valid' is missing", () => {
    assert.throws(
      () => parseViesResponseBody(JSON.stringify({ countryCode: "DE" })),
      (error: unknown) =>
        error instanceof ViesApiError && error.code === "RESPONSE_INVALID",
    );
  });
});
