import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MnbExchangeRateClient,
  parseGetExchangeRatesResponse,
} from "./mnb-exchange-rate.client.js";

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

// The service's answer to GetExchangeRates(2026-09-21, 2026-09-25, EUR),
// byte for byte, as http://www.mnb.hu/arfolyamok.asmx returned it on
// 2026-09-29: note the "s:" prefix and the mixed "364,42" / "366,24000" forms.
const LIVE_RESPONSE_2026_09_29 =
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetExchangeRatesResponse xmlns="http://www.mnb.hu/webservices/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><GetExchangeRatesResult>&lt;MNBExchangeRates&gt;` +
  `&lt;Day date="2026-09-25"&gt;&lt;Rate unit="1" curr="EUR"&gt;364,42&lt;/Rate&gt;&lt;/Day&gt;` +
  `&lt;Day date="2026-09-24"&gt;&lt;Rate unit="1" curr="EUR"&gt;366,24000&lt;/Rate&gt;&lt;/Day&gt;` +
  `&lt;Day date="2026-09-23"&gt;&lt;Rate unit="1" curr="EUR"&gt;363,43&lt;/Rate&gt;&lt;/Day&gt;` +
  `&lt;Day date="2026-09-22"&gt;&lt;Rate unit="1" curr="EUR"&gt;361,73000&lt;/Rate&gt;&lt;/Day&gt;` +
  `&lt;Day date="2026-09-21"&gt;&lt;Rate unit="1" curr="EUR"&gt;362,60000&lt;/Rate&gt;&lt;/Day&gt;&lt;/MNBExchangeRates&gt;</GetExchangeRatesResult></GetExchangeRatesResponse></s:Body></s:Envelope>`;

describe("the live MNB answer", () => {
  it("is read to one rate per quoted day", () => {
    const rates = parseGetExchangeRatesResponse(
      LIVE_RESPONSE_2026_09_29,
      "EUR",
    );
    assert.deepEqual(rates, [
      { date: "2026-09-25", rate: "364.42" },
      { date: "2026-09-24", rate: "366.24" },
      { date: "2026-09-23", rate: "363.43" },
      { date: "2026-09-22", rate: "361.73" },
      { date: "2026-09-21", rate: "362.6" },
    ]);
  });
});

class RecordingClient extends MnbExchangeRateClient {
  readonly urls: string[] = [];

  protected override request(input: string, _init: RequestInit) {
    this.urls.push(input);
    return Promise.resolve(new Response(LIVE_RESPONSE_2026_09_29));
  }
}

describe("MnbExchangeRateClient endpoint", () => {
  async function urlWith(value: string | undefined): Promise<string> {
    const saved = process.env.MNB_API_URL;
    if (value === undefined) delete process.env.MNB_API_URL;
    else process.env.MNB_API_URL = value;
    try {
      const client = new RecordingClient();
      await client.getExchangeRates("2026-09-21", "2026-09-25", "EUR");
      return client.urls[0]!;
    } finally {
      if (saved === undefined) delete process.env.MNB_API_URL;
      else process.env.MNB_API_URL = saved;
    }
  }

  // measured 2026-09-29: the https address answers 404, the http one 200
  it("posts to the http address when no override is set", async () => {
    assert.equal(await urlWith(undefined), "http://www.mnb.hu/arfolyamok.asmx");
  });

  it("treats the empty override of the env templates as no override", async () => {
    assert.equal(await urlWith(""), "http://www.mnb.hu/arfolyamok.asmx");
  });

  it("still honours a real override", async () => {
    assert.equal(
      await urlWith("http://mnb.test/arfolyamok.asmx/"),
      "http://mnb.test/arfolyamok.asmx",
    );
  });
});
