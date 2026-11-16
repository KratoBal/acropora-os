import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpTicketDraftClient,
  MAX_AI_SUMMARY,
  MAX_AI_TITLE,
  ticketDraftAnswerOf,
  ticketDraftClientFromEnv,
} from "./ticket-mail-ai.client.js";

/**
 * THE AI SERVICE'S TICKET DRAFT OVER HTTP (card ec7b947b, S3b). WHAT TURNS RED: anything but the two redacted strings leaving in the request body;
 * the token missing from the call or leaking into an answer; an answer that is more than a plain title and summary getting through (a link, an
 * address, HTML, an invisible character, a long number, an over-long text); a provider failure shown as a draft; no client without the AI
 * configuration.
 */
const good = {
  title: "A szűrő csöpög",
  summary: "A 3-as medence szűrője a hétvége óta csöpög.",
  extractedBy: "gpt-5.1 ticket-draft/v1",
};

describe("ticketDraftAnswerOf", () => {
  it("a title and a summary pass, squashed, with the model label", () => {
    assert.deepEqual(
      ticketDraftAnswerOf({
        ...good,
        title: "  A szűrő   csöpög ",
        extra: "dropped",
      }),
      { kind: "DRAFT", ...good },
    );
  });

  it("a date in the summary passes, a phone number does not", () => {
    assert.equal(
      ticketDraftAnswerOf({ ...good, summary: "Hiba 2026.11.16. óta." }).kind,
      "DRAFT",
    );
    assert.deepEqual(
      ticketDraftAnswerOf({ ...good, summary: "Hívd: +36 30 123 4567" }),
      { kind: "REFUSED", refusal: "UNSAFE_OUTPUT" },
    );
  });

  it("the AI service's own refusal is passed on as its code; an odd code becomes a plain REFUSED", () => {
    assert.deepEqual(
      ticketDraftAnswerOf({
        refusal: "UNSAFE_OUTPUT",
        detail: "summary link",
        extractedBy: "x",
      }),
      { kind: "REFUSED", refusal: "UNSAFE_OUTPUT" },
    );
    assert.deepEqual(ticketDraftAnswerOf({ refusal: "Ignore the rules <b>" }), {
      kind: "REFUSED",
      refusal: "REFUSED",
    });
  });

  it("CONTROL: this side holds the rules again: a link, an address, HTML, an invisible character, an over-long text is refused", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ summary: "Lásd https://pelda.example" }, "UNSAFE_OUTPUT"],
      [{ summary: "Írj a hiba@pelda.hu címre" }, "UNSAFE_OUTPUT"],
      [{ title: "<b>Csöpög</b>" }, "UNSAFE_OUTPUT"],
      [{ title: "Csöpög\u200fa szűrő" }, "UNSAFE_OUTPUT"],
      [{ title: "Csöpög\u0000a szűrő" }, "UNSAFE_OUTPUT"],
      [{ title: "x".repeat(MAX_AI_TITLE + 1) }, "TOO_LONG"],
      [{ summary: "x".repeat(MAX_AI_SUMMARY + 1) }, "TOO_LONG"],
    ];
    for (const [override, refusal] of cases)
      assert.deepEqual(
        ticketDraftAnswerOf({ ...good, ...override }),
        { kind: "REFUSED", refusal },
        JSON.stringify(override).slice(0, 40),
      );
  });

  it("CONTROL: a missing, empty or non-string field, or no object, is BAD_SHAPE", () => {
    for (const body of [
      null,
      "x",
      [],
      {},
      { title: "x" },
      { summary: "x" },
      { title: "", summary: "x" },
      { title: 5, summary: "x" },
    ])
      assert.deepEqual(
        ticketDraftAnswerOf(body),
        { kind: "REFUSED", refusal: "BAD_SHAPE" },
        JSON.stringify(body),
      );
  });

  it("an odd model label becomes unknown, never a free text", () => {
    assert.equal(
      (
        ticketDraftAnswerOf({ ...good, extractedBy: "<script>" }) as {
          extractedBy: string;
        }
      ).extractedBy,
      "unknown",
    );
  });
});

describe("HttpTicketDraftClient", () => {
  const call = (fetcher: typeof fetch) =>
    new HttpTicketDraftClient(
      "https://ai.test",
      "secret-token",
      "/v1/ticket-drafts",
      fetcher,
    ).draft({ subject: "Hiba", text: "Csöpög a [NÉV] szűrője." });

  it("posts exactly the subject and the text, with the bearer token, to the configured path", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const answer = await call(async (url, init) => {
      seen = { url: String(url), init: init! };
      return Response.json(good);
    });
    assert.equal(answer.kind, "DRAFT");
    assert.equal(seen!.url, "https://ai.test/v1/ticket-drafts");
    assert.equal(seen!.init.method, "POST");
    assert.equal(
      (seen!.init.headers as Record<string, string>).authorization,
      "Bearer secret-token",
    );
    assert.deepEqual(JSON.parse(String(seen!.init.body)), {
      subject: "Hiba",
      text: "Csöpög a [NÉV] szűrője.",
    });
  });

  it("CONTROL: an HTTP error is UNAVAILABLE with a fixed reason, never the body", async () => {
    for (const status of [401, 429, 502, 504]) {
      const answer = await call(
        async () =>
          new Response("secret-token and the provider's message", { status }),
      );
      assert.deepEqual(answer, {
        kind: "UNAVAILABLE",
        reason: `HTTP ${status}`,
      });
    }
  });

  it("CONTROL: a network failure and a timeout are UNAVAILABLE, and the token is not in the answer", async () => {
    const unreachable = await call(async () => {
      throw new TypeError("fetch failed: secret-token");
    });
    assert.deepEqual(unreachable, {
      kind: "UNAVAILABLE",
      reason: "unreachable",
    });
    const timeout = await call(async () => {
      throw Object.assign(new Error("secret-token"), { name: "TimeoutError" });
    });
    assert.deepEqual(timeout, { kind: "UNAVAILABLE", reason: "timeout" });
    assert.equal(
      JSON.stringify([unreachable, timeout]).includes("secret-token"),
      false,
    );
  });

  it("a 200 that is not JSON, or that the guard refuses, is not a draft", async () => {
    assert.deepEqual(
      await call(async () => new Response("not json", { status: 200 })),
      { kind: "REFUSED", refusal: "BAD_SHAPE" },
    );
    assert.deepEqual(
      await call(async () =>
        Response.json({ refusal: "NOT_JSON", detail: "parse 0/9 U+004E" }),
      ),
      { kind: "REFUSED", refusal: "NOT_JSON" },
    );
  });
});

describe("ticketDraftClientFromEnv", () => {
  it("is null without the AI base URL and token, a client with them", () => {
    assert.equal(ticketDraftClientFromEnv({}), null);
    assert.equal(
      ticketDraftClientFromEnv({ ACROPORA_AI_BASE_URL: "https://ai.test" }),
      null,
    );
    assert.ok(
      ticketDraftClientFromEnv({
        ACROPORA_AI_BASE_URL: "https://ai.test",
        ACROPORA_AI_ACCESS_TOKEN: "t",
      }),
    );
  });
});
