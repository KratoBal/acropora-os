import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_CHAT_BASE_URL_ENV,
  AI_CHAT_RATING_TIMEOUT_MS,
  AI_CHAT_TIMEOUT_MS,
  AI_CHAT_TOKEN_ENV,
  aiChatConfig,
} from "./ai-chat.config.js";
import { AiChatService, PRODUCT_CONTEXT_NOTE } from "./ai-chat.service.js";

const TOKEN = "ai-access-token-that-must-never-leak";

const environment: NodeJS.ProcessEnv = {
  [AI_CHAT_BASE_URL_ENV]: "https://ai-stage.example/",
  [AI_CHAT_TOKEN_ENV]: TOKEN,
};

const recordingFetch = (respond: () => Response | never) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const good = {
  conversationId: "c-1",
  answer: "Egy válasz.",
  model: "gpt-5.1",
  customerContextStatus: "anonymous",
};

describe("aiChatConfig", () => {
  it("needs both halves and trims the trailing slash", () => {
    assert.deepEqual(aiChatConfig(environment), {
      baseUrl: "https://ai-stage.example",
      token: TOKEN,
    });
    assert.equal(aiChatConfig({}), null);
    assert.equal(aiChatConfig({ [AI_CHAT_BASE_URL_ENV]: "https://x" }), null);
    assert.equal(aiChatConfig({ [AI_CHAT_TOKEN_ENV]: TOKEN }), null);
  });
});

describe("AiChatService", () => {
  it("sends the token from here and never returns it", async () => {
    const { impl, calls } = recordingFetch(() => json(good));
    const service = new AiChatService(environment, impl);

    const reply = await service.ask({ message: "Szia" });

    // What went out, not what was passed in: the token is this layer's whole
    // reason for existing, and it has to be on the outgoing request.
    const call = calls[0];
    assert.ok(call, "a hivasnak meg kellett tortennie");
    assert.equal(call.url, "https://ai-stage.example/v1/chat");
    assert.equal(
      (call.init.headers as Record<string, string>).authorization,
      `Bearer ${TOKEN}`,
    );
    assert.equal(JSON.stringify(reply).includes(TOKEN), false);
  });

  it("carries the fields the surface has to show", async () => {
    const { impl } = recordingFetch(() => json(good));
    const service = new AiChatService(environment, impl);

    const reply = await service.ask({ message: "Szia" });

    assert.equal(reply.conversationId, "c-1");
    assert.equal(reply.model, "gpt-5.1");
    assert.equal(reply.customerContextStatus, "anonymous");
    assert.equal(reply.answer, "Egy válasz.");
    assert.ok(reply.elapsedMs >= 0);
    assert.equal(reply.errorCode, null);
  });

  it("always states that there is no product context", async () => {
    // Balazs's own sentence, on every answer. A blank field would read as
    // "nothing to report" rather than "the catalogue is not wired in".
    const { impl } = recordingFetch(() => json(good));
    const reply = await new AiChatService(environment, impl).ask({
      message: "Szia",
    });

    assert.equal(reply.productContext, PRODUCT_CONTEXT_NOTE);
    assert.match(reply.productContext, /Nincs termékkontextus/);
    assert.equal(reply.productContext.includes(" - "), false);
  });

  it("passes the AI's own timeout through, with how long it waited", async () => {
    // The most useful number on the screen: not that something failed, but
    // that it timed out and after how long.
    const { impl } = recordingFetch(() =>
      json({ error: "ai_provider_timeout", waitedMs: 40004 }, 504),
    );

    const reply = await new AiChatService(environment, impl).ask({
      message: "Szia",
    });

    assert.equal(reply.errorCode, "ai_provider_timeout");
    assert.equal(reply.providerWaitedMs, 40004);
    assert.equal(reply.httpStatus, 504);
    assert.equal(reply.answer, null);
  });

  it("says when it was never configured, instead of failing silently", async () => {
    const { impl, calls } = recordingFetch(() => json(good));

    const reply = await new AiChatService({}, impl).ask({ message: "Szia" });

    assert.equal(reply.errorCode, "ai_not_configured");
    assert.equal(calls.length, 0);
  });

  it("tells a timeout of its own apart from an unreachable service", async () => {
    const timedOut = recordingFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    const refused = recordingFetch(() => {
      throw new TypeError("fetch failed");
    });

    assert.equal(
      (
        await new AiChatService(environment, timedOut.impl).ask({
          message: "x",
        })
      ).errorCode,
      "ai_gateway_timeout",
    );
    assert.equal(
      (await new AiChatService(environment, refused.impl).ask({ message: "x" }))
        .errorCode,
      "ai_unreachable",
    );
  });

  it("does not invent an answer out of a body it cannot read", async () => {
    const { impl } = recordingFetch(
      () => new Response("<html>", { status: 200 }),
    );

    const reply = await new AiChatService(environment, impl).ask({
      message: "Szia",
    });

    assert.equal(reply.errorCode, "ai_bad_response");
    assert.equal(reply.answer, null);
  });
});

/**
 * Sending a judgement on to the AI service.
 *
 * The chat tests above prove the token leaves from here and never comes back.
 * These prove the same for the second call, and one thing more that only this
 * hop can be responsible for: the name on a judgement comes from the session,
 * so the service is given it rather than reading it from anything a browser
 * could have written.
 */
describe("AiChatService.rate", () => {
  const MESSAGE_ID = "b2c4d6e8-0a1b-4c3d-8e5f-9a7b6c5d4e3f";

  const stored = {
    messageId: MESSAGE_ID,
    rating: "inaccurate",
    ratedBy: "user_7",
    ratedAt: "2026-08-26T20:00:00.000Z",
  };

  it("addresses the answer, carries the token, and returns neither", async () => {
    const { impl, calls } = recordingFetch(() => json(stored));
    const service = new AiChatService(environment, impl);

    const result = await service.rate({
      messageId: MESSAGE_ID,
      rating: "inaccurate",
      ratedBy: "user_7",
    });

    const call = calls[0];
    assert.ok(call, "a hivasnak meg kellett tortennie");
    assert.equal(
      call.url,
      `https://ai-stage.example/v1/messages/${MESSAGE_ID}/rating`,
    );
    assert.equal(
      (call.init.headers as Record<string, string>).authorization,
      `Bearer ${TOKEN}`,
    );
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.deepEqual(result, {
      rating: "inaccurate",
      ratedAt: "2026-08-26T20:00:00.000Z",
      errorCode: null,
    });
  });

  it("sends the author it was given, not one the browser could choose", async () => {
    // The controller passes the session user. What this asserts is that the
    // service does not invent, default or read one from anywhere else.
    const { impl, calls } = recordingFetch(() => json(stored));
    const service = new AiChatService(environment, impl);

    await service.rate({
      messageId: MESSAGE_ID,
      rating: "correct",
      ratedBy: "user_9",
    });

    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), {
      rating: "correct",
      ratedBy: "user_9",
    });
  });

  it("says so when the AI is not configured, and never calls out", async () => {
    const { impl, calls } = recordingFetch(() => json(stored));
    const service = new AiChatService({}, impl);

    const result = await service.rate({
      messageId: MESSAGE_ID,
      rating: "correct",
      ratedBy: "user_7",
    });

    assert.deepEqual(result, {
      rating: null,
      ratedAt: null,
      errorCode: "ai_not_configured",
    });
    assert.equal(calls.length, 0);
  });

  it("passes the AI's own refusal through instead of a generic failure", async () => {
    // A 404 here means the answer is not ours to judge, and the surface can
    // say something true about that. "Something went wrong" cannot.
    const { impl } = recordingFetch(() =>
      json({ error: "answer not found" }, 404),
    );
    const service = new AiChatService(environment, impl);

    const result = await service.rate({
      messageId: MESSAGE_ID,
      rating: "correct",
      ratedBy: "user_7",
    });

    assert.deepEqual(result, {
      rating: null,
      ratedAt: null,
      errorCode: "answer not found",
    });
  });

  it("reports a timeout as one, and reports nothing else about it", async () => {
    const { impl } = recordingFetch(() => {
      const error = new Error("The operation was aborted");
      error.name = "TimeoutError";
      throw error;
    });
    const service = new AiChatService(environment, impl);

    const result = await service.rate({
      messageId: MESSAGE_ID,
      rating: "correct",
      ratedBy: "user_7",
    });

    assert.deepEqual(result, {
      rating: null,
      ratedAt: null,
      errorCode: "ai_gateway_timeout",
    });
  });

  it("does not wait a model-sized minute for a row to be written", async () => {
    /**
     * A rating is not a model call, and the wait says so. Inheriting the chat
     * timeout would leave somebody who pressed a button watching a spinner
     * for the better part of a minute before being told the AI is down.
     */
    assert.ok(AI_CHAT_RATING_TIMEOUT_MS < AI_CHAT_TIMEOUT_MS / 4);
  });
});
