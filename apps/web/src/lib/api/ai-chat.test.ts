import { describe, expect, it, vi, afterEach } from "vitest";

import { AI_CHAT_CLIENT_TIMEOUT_MS, aiChatApi } from "./ai-chat";

/**
 * A két időkorlát viszonya a lényeg, nem az értékük.
 *
 * A szerver 47 másodperc után NEVESÍTETT hibát ad (`ai_gateway_timeout`). Ha a
 * böngésző hamarabb szakítana, az a hiba sosem érne a képernyőig, és a
 * felhasználó általános hálózati hibát látna a pontos ok helyett. Ez a teszt
 * azt a viszonyt őrzi, amit a komment leír.
 */
const SERVER_TIMEOUT_MS = 47_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("az AI-hívás időkorlátja a böngészőben", () => {
  it("TOVÁBB vár, mint a szerver, hogy a nevesített hiba megérkezhessen", () => {
    expect(AI_CHAT_CLIENT_TIMEOUT_MS).toBeGreaterThan(SERVER_TIMEOUT_MS);
  });

  it("korlátos marad: nem a böngésző alapértelmezésére bízza", () => {
    expect(Number.isFinite(AI_CHAT_CLIENT_TIMEOUT_MS)).toBe(true);
    expect(AI_CHAT_CLIENT_TIMEOUT_MS).toBeLessThan(120_000);
  });

  it("ad jelzést a hívásnak akkor is, ha a hívó nem adott", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ answer: "..." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await aiChatApi.ask("token", { message: "kérdés" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a hívó saját jelzése erősebb, ha adott", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ answer: "..." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const own = new AbortController().signal;

    await aiChatApi.ask("token", { message: "kérdés" }, own);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(own);
  });
});
