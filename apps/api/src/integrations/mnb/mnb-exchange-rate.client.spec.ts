import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGetExchangeRatesResponse } from "./mnb-exchange-rate.client.js";

function soapResponse(innerXml: string): string {
  const escaped = innerXml
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<GetExchangeRatesResponse xmlns="http://www.mnb.hu/webservices/">` +
    `<GetExchangeRatesResult>${escaped}</GetExchangeRatesResult>` +
    `</GetExchangeRatesResponse>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

describe("parseGetExchangeRatesResponse", () => {
  it("parses the documented MNB example (comma decimal, unit=1)", () => {
    const inner =
      `<MNBExchangeRates><Day date="2026-07-20">` +
      `<Rate unit="1" curr="EUR">402,15</Rate>` +
      `</Day></MNBExchangeRates>`;
    const rates = parseGetExchangeRatesResponse(soapResponse(inner), "EUR");
    assert.deepEqual(rates, [{ date: "2026-07-20", rate: "402.15" }]);
  });

  it("divides by the unit attribute for currencies quoted per 100 units", () => {
    const inner =
      `<MNBExchangeRates><Day date="2026-07-20">` +
      `<Rate unit="100" curr="JPY">226,00</Rate>` +
      `</Day></MNBExchangeRates>`;
    const rates = parseGetExchangeRatesResponse(soapResponse(inner), "JPY");
    assert.deepEqual(rates, [{ date: "2026-07-20", rate: "2.26" }]);
  });

  it("returns an empty array when no Day was quoted (blank result)", () => {
    const rates = parseGetExchangeRatesResponse(soapResponse(""), "EUR");
    assert.deepEqual(rates, []);
  });

  it("returns multiple days across a range, ignoring other currencies", () => {
    const inner =
      `<MNBExchangeRates>` +
      `<Day date="2026-07-17"><Rate unit="1" curr="EUR">401,90</Rate><Rate unit="1" curr="USD">370,00</Rate></Day>` +
      `<Day date="2026-07-20"><Rate unit="1" curr="EUR">402,15</Rate></Day>` +
      `</MNBExchangeRates>`;
    const rates = parseGetExchangeRatesResponse(soapResponse(inner), "EUR");
    assert.deepEqual(rates, [
      { date: "2026-07-17", rate: "401.9" },
      { date: "2026-07-20", rate: "402.15" },
    ]);
  });
});
