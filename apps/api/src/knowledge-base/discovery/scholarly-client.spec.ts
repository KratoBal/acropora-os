import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeClock } from "./discovery-test-fixtures.js";
import {
  API_DELAY_MS,
  DISCOVERY_USER_AGENT,
  RETRY_429_MS,
  RequestLimitReached,
  ScholarlyClient,
  type ApiFetch,
} from "./scholarly-client.js";

/** Answers in order; records the time and headers of every request. */
function sequence(
  answers: {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  }[],
  clock: ReturnType<typeof fakeClock>,
) {
  const seen: { at: number; agent: string | undefined }[] = [];
  const fetch: ApiFetch = async (_url, init) => {
    seen.push({ at: clock.now().getTime(), agent: init.headers["User-Agent"] });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return new Response(next.body ?? "{}", {
      status: next.status,
      headers: next.headers ?? {},
    });
  };
  return { fetch, seen };
}

function client(
  fetch: ApiFetch,
  clock: ReturnType<typeof fakeClock>,
  requestLimit = 10,
) {
  return new ScholarlyClient({
    fetch,
    sleep: clock.sleep,
    now: clock.now,
    requestLimit,
  });
}

describe("the scholarly API client", () => {
  it("keeps the pace per API and says who it is", async () => {
    const clock = fakeClock();
    const net = sequence(
      [{ status: 200 }, { status: 200 }, { status: 200 }],
      clock,
    );
    const c = client(net.fetch, clock);
    await c.getJson("CROSSREF", "https://api.crossref.org/a");
    await c.getJson("CROSSREF", "https://api.crossref.org/b");
    await c.getJson("OPENALEX", "https://api.openalex.org/c");
    assert.equal(net.seen[1]!.at - net.seen[0]!.at, API_DELAY_MS.CROSSREF);
    assert.equal(net.seen[2]!.at, net.seen[1]!.at, "another API does not wait");
    assert.ok(net.seen.every((s) => s.agent === DISCOVERY_USER_AGENT));
  });

  it("a 429 is waited out as Retry-After asks, and the retry counts", async () => {
    const clock = fakeClock();
    const net = sequence(
      [
        { status: 429, headers: { "retry-after": "7" } },
        { status: 200, body: '{"x":1}' },
      ],
      clock,
    );
    const c = client(net.fetch, clock);
    const answer = await c.getJson("CROSSREF", "https://api.crossref.org/a");
    assert.deepEqual(answer, { ok: true, json: { x: 1 }, httpStatus: 200 });
    assert.equal(net.seen[1]!.at - net.seen[0]!.at, 7_000);
    assert.equal(c.requestCount, 2);
    assert.equal(c.unavailable.size, 0);
  });

  it("without Retry-After the default waits apply, and the retries are bounded", async () => {
    const clock = fakeClock();
    const net = sequence(
      [{ status: 429 }, { status: 429 }, { status: 429 }, { status: 200 }],
      clock,
    );
    const c = client(net.fetch, clock);
    const answer = await c.getJson("CROSSREF", "https://api.crossref.org/a");
    assert.deepEqual(answer, {
      ok: false,
      reason: "HTTP_429",
      httpStatus: 429,
    });
    assert.equal(net.seen.length, 1 + RETRY_429_MS.length);
    assert.equal(net.seen[1]!.at - net.seen[0]!.at, RETRY_429_MS[0]);
    assert.equal(net.seen[2]!.at - net.seen[1]!.at, RETRY_429_MS[1]);
    assert.equal(c.unavailable.get("CROSSREF"), "HTTP_429");
    // the API is out for the run: no further request goes to it
    const later = await c.getJson("CROSSREF", "https://api.crossref.org/b");
    assert.equal(later.ok, false);
    assert.equal(net.seen.length, 3);
  });

  it("a Retry-After that is a day's budget is not waited", async () => {
    const clock = fakeClock();
    const net = sequence(
      [{ status: 429, headers: { "retry-after": "36000" } }],
      clock,
    );
    const c = client(net.fetch, clock);
    const answer = await c.getJson("OPENALEX", "https://api.openalex.org/a");
    assert.equal(answer.ok, false);
    assert.equal(net.seen.length, 1);
    assert.equal(c.unavailable.get("OPENALEX"), "HTTP_429");
  });

  it("a retry does not pass the request limit", async () => {
    const clock = fakeClock();
    const net = sequence([{ status: 429 }, { status: 200 }], clock);
    const c = client(net.fetch, clock, 1);
    await assert.rejects(
      c.getJson("CROSSREF", "https://api.crossref.org/a"),
      RequestLimitReached,
    );
    assert.equal(net.seen.length, 1);
  });

  it("a 404 is about the URL, a 5xx or a non-JSON body about the API", async () => {
    const clock = fakeClock();
    const net = sequence(
      [
        { status: 404 },
        { status: 200 },
        { status: 200, body: "<html>" },
        { status: 502 },
      ],
      clock,
    );
    const c = client(net.fetch, clock);
    assert.equal((await c.getJson("CROSSREF", "u1")).ok, false);
    assert.equal(
      (await c.getJson("CROSSREF", "u2")).ok,
      true,
      "a 404 left Crossref usable",
    );
    const notJson = await c.getJson("OPENALEX", "u3");
    assert.deepEqual(notJson, {
      ok: false,
      reason: "NOT_JSON",
      httpStatus: 200,
    });
    const down = await c.getJson("EUROPE_PMC", "u4");
    assert.deepEqual(down, { ok: false, reason: "HTTP_502", httpStatus: 502 });
    assert.deepEqual(Object.fromEntries(c.unavailable), {
      OPENALEX: "NOT_JSON",
      EUROPE_PMC: "HTTP_502",
    });
  });
});
