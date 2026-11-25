import { afterEach, describe, expect, it, vi } from "vitest";

import { inventoryApi } from "./inventory";

/**
 * A LELTÁRLISTA KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha a rendezés kulcsai nem kerülnek a kérésbe, vagy csak az egyik fele (mező irány
 * nélkül nem rendezés); ha rendezés nélkül is odakerülnek; ha a rendezés elnyeli az állapot-szűrőt vagy a lapozást.
 */
describe("inventoryApi.list", () => {
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = async (query: Parameters<typeof inventoryApi.list>[1]) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await inventoryApi.list("token-1", query);
    return String(fetchMock.mock.calls[0]![0]);
  };

  it("puts the sort field and direction in the query, beside the filter and the paging", async () => {
    const url = await urlOf({
      page: 2,
      pageSize: 20,
      status: "DRAFT",
      sort: "lineCount",
      direction: "desc",
    });
    expect(url).toContain("sort=lineCount");
    expect(url).toContain("direction=desc");
    expect(url).toContain("status=DRAFT");
    expect(url).toContain("page=2");
  });

  it("leaves both out without a sort, and a lone field is not a sort", async () => {
    const plain = await urlOf({ page: 1, pageSize: 20 });
    expect(plain).not.toContain("sort=");
    expect(plain).not.toContain("direction=");
    expect(await urlOf({ sort: "countNumber" })).not.toContain("sort=");
  });
});
