import { afterEach, describe, expect, it, vi } from "vitest";

import { quotesApi } from "./quotes";

/*
  A TÉTELEK SORRENDJE A KLIENSBEN (Luca, 2026-11-26, acrobot 62604): a hívás a BLOKK TÉTEL-sorrend útvonalára megy (`/blocks/:blockId/items/reorder`), nem a blokkok sorrendjére
  (`/blocks/reorder`), és a törzs a blokk tételeinek azonosítói. MI PIROSÍT: ha a tétel-mozgatás a blokk-sorrend útvonalát hívja (a szerver a blokk-azonosítók helyett tétel-azonosítókat kapna, és elutasítaná);
  ha az azonosítók nem `ids` kulcson mennek; ha a blokk azonosítója kimarad az útból.
*/
afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "q1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("quotesApi.reorderItems", () => {
  it("a blokk tétel-sorrend útvonalára küld POST-ot, `ids` törzzsel", async () => {
    const fetchMock = mockFetch();
    await quotesApi.reorderItems("token", "q1", "v2", "b1", ["i3", "i1", "i2"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(
      /\/quotes\/q1\/versions\/v2\/blocks\/b1\/items\/reorder$/,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ ids: ["i3", "i1", "i2"] });
  });

  it("a blokk-sorrend hívása külön útvonal marad", async () => {
    const fetchMock = mockFetch();
    await quotesApi.reorderBlocks("token", "q1", "v2", ["b2", "b1"]);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/quotes\/q1\/versions\/v2\/blocks\/reorder$/);
    expect(String(url)).not.toContain("/items/");
  });
});
