import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../../testing/source-mask.js";
import {
  EBIZ_BASE_URL,
  EbizClient,
  EbizError,
  ebizApiKey,
  type EbizFetch,
} from "./ebiz.client.js";

/** Records every call; answers from a queue (the last answer repeats). */
function recordingFetch(answers: (() => Response)[]) {
  const calls: { url: string; method: string; key: string | undefined }[] = [];
  const fetcher: EbizFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      key: init.headers["X-OTP-eBIZ-API-Key"],
    });
    const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
    return answer();
  };
  return { calls, fetcher };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
const pdf = () =>
  new Response(new TextEncoder().encode("%PDF-1.4 kitalált"), { status: 200 });

class NoSleepClient extends EbizClient {
  readonly waits: number[] = [];
  protected override wait(ms: number): Promise<void> {
    this.waits.push(ms);
    return Promise.resolve();
  }
}

const KEY = { OTP_EBIZ_API_KEY: "kitalalt-kulcs" };

describe("OTP eBIZ kliens: csak olvasás", () => {
  it("minden hívás GET, a kulcs a fejlécben, az éles alapcímre", async () => {
    const { calls, fetcher } = recordingFetch([
      () => json({ data: [], pager: { total: 0 } }),
      () => json({ id: 1, invoiceNumber: "TEST000001" }),
      pdf,
    ]);
    const client = new NoSleepClient(fetcher, KEY);
    await client.listInvoices(0);
    await client.getInvoice(1);
    await client.downloadInvoicePdf(1);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.method === "GET"));
    assert.ok(calls.every((c) => c.key === "kitalalt-kulcs"));
    assert.ok(calls.every((c) => c.url.startsWith(`${EBIZ_BASE_URL}/v1/`)));
    assert.match(
      calls[0]!.url,
      /\/v1\/invoices\?offset=0&limit=50&ordering=ISSUE_DATE&sorting=ASC$/,
    );
    assert.match(calls[2]!.url, /\/v1\/invoices\/id\/1\/download$/);
  });

  it("a forrás nem ismer írást: nincs más metódus, nincs cancel/send, nincs POST", () => {
    const raw = readFileSync("src/integrations/ebiz/ebiz.client.ts", "utf8");
    // the header comment names the write paths on purpose; the code must not
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const code = maskCommentsAndStrings(raw);
    assert.ok(raw.includes("/download"), "the file was read");
    // the only method literal in the code is GET
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual([...new Set(methods)], ["GET"]);
    for (const forbidden of ["POST", "PUT", "PATCH", "DELETE"])
      assert.ok(
        !source.includes(`"${forbidden}"`),
        `no "${forbidden}" literal`,
      );
    assert.ok(
      !/\/cancel|\/send|createInvoice/.test(source),
      "no write path is named",
    );
    // and nothing in the code passes a method through from outside
    assert.ok(!/method:\s*[a-z]/.test(code), "the method is never a variable");
  });

  it("kulcs nélkül nem hív ki, és ezt hibakóddal mondja", async () => {
    const { calls, fetcher } = recordingFetch([() => json({ data: [] })]);
    const client = new NoSleepClient(fetcher, {});
    assert.equal(client.configured(), false);
    await assert.rejects(
      () => client.listInvoices(0),
      (error) =>
        error instanceof EbizError && error.code === "EBIZ_NOT_CONFIGURED",
    );
    assert.equal(calls.length, 0);
    assert.equal(ebizApiKey({ OTP_EBIZ_API_KEY: "  " }), null);
  });

  it("429-re vár és újrapróbál; ha elfogyott a keret, a következő hívás előtt vár", async () => {
    const { calls, fetcher } = recordingFetch([
      () =>
        new Response("", { status: 429, headers: { "RateLimit-Reset": "3" } }),
      () =>
        json(
          { data: [] },
          { "RateLimit-Remaining": "0", "RateLimit-Reset": "5" },
        ),
      () => json({ data: [] }),
    ]);
    const client = new NoSleepClient(fetcher, KEY);
    await client.listInvoices(0);
    await client.listInvoices(1);
    assert.equal(calls.length, 3);
    assert.deepEqual(client.waits, [3000, 5000]);
  });

  it("a tartós 429 és a jogosultsági hiba érthető kódot ad", async () => {
    const limited = new NoSleepClient(
      recordingFetch([() => new Response("", { status: 429 })]).fetcher,
      KEY,
    );
    await assert.rejects(
      () => limited.listInvoices(0),
      (error) =>
        error instanceof EbizError && error.code === "EBIZ_RATE_LIMITED",
    );
    const denied = new NoSleepClient(
      recordingFetch([() => new Response("", { status: 401 })]).fetcher,
      KEY,
    );
    await assert.rejects(
      () => denied.getInvoice(1),
      (error) =>
        error instanceof EbizError && error.code === "EBIZ_AUTH_FAILED",
    );
  });

  it("ami nem PDF, azt nem fogadja el PDF-ként; a HTML-t adó lista sem lista", async () => {
    const html = () =>
      new Response("<html>mock</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const client = new NoSleepClient(recordingFetch([html]).fetcher, KEY);
    await assert.rejects(
      () => client.downloadInvoicePdf(1),
      (error) => error instanceof EbizError && error.code === "EBIZ_NOT_PDF",
    );
    await assert.rejects(
      () => client.listInvoices(0),
      (error) =>
        error instanceof EbizError && error.code === "EBIZ_BAD_RESPONSE",
    );
  });
});
