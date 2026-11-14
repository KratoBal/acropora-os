import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_RATE_LIMIT_RETRIES,
  AI_RETRY_AFTER_DEFAULT_MS,
  AI_RETRY_AFTER_MAX_MS,
  aiPost,
  retryAfterMs,
} from "./ai-call.js";
import { HttpProductFieldExtractor } from "./product-field-extraction.js";

/*
  WHAT TURNS THIS RED (T4.4 pilot-20 fourth run, card 8639ac2a; acrobot 52514). A 429 answered at once instead of
  waiting as its Retry-After says; more than three retries, or none; a wait above a minute; a still-429 call ending as
  anything but RATE_LIMITED (a silent gap); a non-429 error retried.
*/
const response = (status: number, body: unknown = {}, retryAfter?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
  });

function scripted(answers: Response[]) {
  const calls: string[] = [];
  const waits: number[] = [];
  return {
    calls,
    waits,
    deps: {
      fetch: (async (url: string | URL | Request) => {
        calls.push(String(url));
        const next = answers.shift();
        if (!next) throw new Error("no more answers");
        return next;
      }) as typeof fetch,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      now: () => Date.parse("2026-11-14T16:00:00Z"),
    },
  };
}

describe("a Retry-After", () => {
  it("másodperc vagy dátum, alapból 5 mp, legfeljebb egy perc", () => {
    const now = Date.parse("2026-11-14T16:00:00Z");
    assert.equal(retryAfterMs("12", now), 12_000);
    assert.equal(retryAfterMs("Sat, 14 Nov 2026 16:00:30 GMT", now), 30_000);
    assert.equal(retryAfterMs(null, now), AI_RETRY_AFTER_DEFAULT_MS);
    assert.equal(retryAfterMs("nem szám", now), AI_RETRY_AFTER_DEFAULT_MS);
    assert.equal(retryAfterMs("3600", now), AI_RETRY_AFTER_MAX_MS);
    // barracuda on #2563: a fraction is seconds, not a date (Date.parse reads "1.5" as the year 2001)
    assert.equal(retryAfterMs("1.5", now), 1_500);
  });
});

describe("az AI-hívás ütemezése", () => {
  it("429 után a Retry-After szerint vár, és újra próbálja", async () => {
    const s = scripted([
      response(429, {}, "7"),
      response(429),
      response(200, { ok: 1 }),
    ]);
    const r = await aiPost(
      "https://ai.example.invalid/v1/x",
      "t",
      { a: 1 },
      s.deps,
    );
    assert.deepEqual(r, { ok: true, body: { ok: 1 } });
    assert.equal(s.calls.length, 3);
    assert.deepEqual(s.waits, [7_000, AI_RETRY_AFTER_DEFAULT_MS]);
  });

  it("háromszori újrapróba után is 429: RATE_LIMITED, nem csendes hiány", async () => {
    const s = scripted(
      Array.from({ length: AI_RATE_LIMIT_RETRIES + 1 }, () =>
        response(429, {}, "1"),
      ),
    );
    const r = await aiPost("https://ai.example.invalid/v1/x", "t", {}, s.deps);
    assert.deepEqual(r, { ok: false, reason: "RATE_LIMITED" });
    assert.equal(s.calls.length, AI_RATE_LIMIT_RETRIES + 1);
    assert.equal(s.waits.length, AI_RATE_LIMIT_RETRIES);
  });

  it("a 429-es válasz törzse lezárul az újrapróba előtt (barracuda, #2563)", async () => {
    const cancelled: number[] = [];
    const limited = (n: number) =>
      new Response(
        new ReadableStream({
          cancel: () => {
            cancelled.push(n);
          },
        }),
        { status: 429, headers: { "retry-after": "1" } },
      );
    const s = scripted([limited(1), limited(2), response(200, { ok: 1 })]);
    await aiPost("https://ai.example.invalid/v1/x", "t", {}, s.deps);
    assert.deepEqual(cancelled, [1, 2]);
  });

  it("más hiba nem próbálkozik újra", async () => {
    const s = scripted([response(503)]);
    assert.deepEqual(
      await aiPost("https://ai.example.invalid/v1/x", "t", {}, s.deps),
      {
        ok: false,
        reason: "HTTP 503",
      },
    );
    assert.equal(s.calls.length, 1);
    assert.deepEqual(s.waits, []);
  });

  it("a kivonatoló is így hív: a 429 után jön a válasz, a végén a RATE_LIMITED látszik", async () => {
    const ok = scripted([
      response(429, {}, "2"),
      response(200, { fields: [], refusedFields: [] }),
    ]);
    const extractor = new HttpProductFieldExtractor(
      "https://ai.example.invalid",
      "t",
      "v1/f",
      ok.deps,
    );
    assert.deepEqual(
      await extractor.extract({
        productName: "X",
        pageText: "y",
        fields: ["application"],
      }),
      { kind: "ANSWER", fields: [], refused: [] },
    );
    assert.deepEqual(ok.waits, [2_000]);
    const limited = scripted(
      Array.from({ length: AI_RATE_LIMIT_RETRIES + 1 }, () => response(429)),
    );
    const again = new HttpProductFieldExtractor(
      "https://ai.example.invalid",
      "t",
      "v1/f",
      limited.deps,
    );
    assert.deepEqual(
      await again.extract({
        productName: "X",
        pageText: "y",
        fields: ["application"],
      }),
      { kind: "UNAVAILABLE", reason: "RATE_LIMITED" },
    );
  });
});
