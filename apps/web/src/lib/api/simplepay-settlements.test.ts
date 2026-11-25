import { afterEach, describe, expect, it, vi } from "vitest";

import { simplePaySettlementsApi } from "./simplepay-settlements";

/**
 * A SIMPLEPAY-KIMUTATÁSOK LISTÁJÁNAK KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha a rendezés kulcsai nem kerülnek a kérésbe, vagy csak az egyik
 * fele (mező irány nélkül nem rendezés); ha rendezés nélkül is odakerülnek.
 */
describe("simplePaySettlementsApi.list", () => {
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = async (
    query: Parameters<typeof simplePaySettlementsApi.list>[1],
  ) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await simplePaySettlementsApi.list("token-1", query);
    return String(fetchMock.mock.calls[0]![0]);
  };

  it("puts the sort field and direction in the query", async () => {
    const url = await urlOf({ sort: "netTotal", direction: "desc" });
    expect(url).toContain("sort=netTotal");
    expect(url).toContain("direction=desc");
  });

  it("leaves both out without a sort, and a lone field is not a sort", async () => {
    const plain = await urlOf({});
    expect(plain).not.toContain("sort=");
    expect(plain).not.toContain("direction=");
    expect(await urlOf({ sort: "amountTotal" })).not.toContain("sort=");
  });
});
