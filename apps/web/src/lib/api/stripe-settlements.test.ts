import { afterEach, describe, expect, it, vi } from "vitest";

import { stripeSettlementsApi } from "./stripe-settlements";

/**
 * A STRIPE-KIFIZETÉSEK LISTÁJÁNAK KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha a rendezés kulcsai nem kerülnek a kérésbe, vagy csak az egyik
 * fele (mező irány nélkül nem rendezés: a szerver az irányt alapnak venné); ha rendezés nélkül is odakerülnek.
 */
describe("stripeSettlementsApi.list", () => {
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = async (
    query: Parameters<typeof stripeSettlementsApi.list>[1],
  ) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await stripeSettlementsApi.list("token-1", query);
    return String(fetchMock.mock.calls[0]![0]);
  };

  it("puts the sort field and direction in the query", async () => {
    const url = await urlOf({ sort: "feeTotal", direction: "desc" });
    expect(url).toContain("sort=feeTotal");
    expect(url).toContain("direction=desc");
  });

  it("leaves both out without a sort, and a lone field is not a sort", async () => {
    const plain = await urlOf({});
    expect(plain).not.toContain("sort=");
    expect(plain).not.toContain("direction=");
    expect(await urlOf({ sort: "amount" })).not.toContain("sort=");
  });
});
