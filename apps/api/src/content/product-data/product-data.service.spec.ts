import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import { ServiceUnavailableException } from "@nestjs/common";

import type { ProductDataRepository } from "./product-data.repository.js";
import { ProductDataService, notFound } from "./product-data.service.js";
import type { ProductRow } from "./product-data.view.js";

/*
  WHAT TURNS THIS RED (spec 4): a failed read that comes back as an empty list or a zero instead of an error; an
  identifier that matches nothing and is silently dropped; a cut list that does not say it was cut; the Omnibus history
  read for a variant whose sale does not run (a wasted query per variant) or NOT read for one whose sale runs.
*/
const D = (v: string) => new Prisma.Decimal(v);
const NOW = new Date("2026-11-12T08:00:00Z");

function row(id: string, sku: string, sale: boolean): ProductRow {
  return {
    id,
    name: id,
    isActive: true,
    archivedAt: null,
    type: "PHYSICAL",
    catalogAuthority: "UNAS",
    brand: null,
    categories: [],
    channelListings: [],
    unasSnapshot: {
      grossPrice: D("1000"),
      currency: null,
      saleGrossPrice: sale ? D("800") : null,
      saleStartsAt: null,
      saleEndsAt: null,
      productUrl: null,
    },
    shippingProfile: null,
    priceChanges: [],
    livestockArrivals: [],
    variants: [
      {
        id: `${id}-v`,
        sku,
        name: null,
        isActive: true,
        sellingGrossPrice: null,
        sellingPriceCurrency: null,
        sellingSaleGrossPrice: null,
        sellingSaleStartsAt: null,
        sellingSaleEndsAt: null,
        unasVariantExtraGrossPrice: null,
        extension: null,
        stockItems: [],
        countedLines: [],
        purchaseLines: [],
      },
    ],
  };
}

function service(
  rows: ProductRow[],
  opts: { total?: number; fail?: boolean; omnibusCalls?: string[] } = {},
) {
  const repository = {
    categoryTree: async () => [],
    count: async () => {
      if (opts.fail) throw new Error("connection refused");
      return opts.total ?? rows.length;
    },
    rows: async () => rows,
  } as unknown as ProductDataRepository;
  return new ProductDataService(
    repository,
    () => NOW,
    async (id) => {
      opts.omnibusCalls?.push(id);
      return null;
    },
  );
}

describe("ProductDataService.read", () => {
  it("stamps the read, names the source, and answers every row", async () => {
    const r = await service([row("p1", "S1", false)]).read({
      query: { identifiers: ["p1"] },
      limit: 50,
      offset: 0,
    });
    assert.equal(r.queriedAt, NOW.toISOString());
    assert.equal(r.source, "Acropora OS");
    assert.equal(r.products.length, 1);
    assert.deepEqual(r.notFound, []);
    assert.equal(r.truncated, false);
  });

  it("a failed read is a 503 that says it is NOT an empty result, never []", async () => {
    await assert.rejects(
      service([], { fail: true }).read({
        query: { identifiers: ["p1"] },
        limit: 50,
        offset: 0,
      }),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /nem üres eredmény/.test(error.message),
    );
  });

  it("a failing Omnibus read fails the whole answer, it is not skipped", async () => {
    const repository = {
      categoryTree: async () => [],
      count: async () => 1,
      rows: async () => [row("p1", "S1", true)],
    } as unknown as ProductDataRepository;
    const s = new ProductDataService(
      repository,
      () => NOW,
      async () => {
        throw new Error("history unavailable");
      },
    );
    await assert.rejects(
      s.read({ query: { onSale: true }, limit: 50, offset: 0 }),
      ServiceUnavailableException,
    );
  });

  it("reads the Omnibus history only for variants whose sale runs", async () => {
    const calls: string[] = [];
    await service([row("a", "SA", true), row("b", "SB", false)], {
      omnibusCalls: calls,
    }).read({ query: { onSale: true }, limit: 50, offset: 0 });
    assert.deepEqual(calls, ["a-v"]);
  });

  it("names the identifiers that matched nothing", async () => {
    const r = await service([row("p1", "S1", false)]).read({
      query: { identifiers: ["p1", "S1", "ghost"] },
      limit: 50,
      offset: 0,
    });
    assert.deepEqual(r.notFound, ["ghost"]);
  });

  it("says when the list was cut", async () => {
    const r = await service([row("p1", "S1", false)], { total: 7 }).read({
      query: { onSale: true },
      limit: 1,
      offset: 3,
    });
    assert.equal(r.totalMatched, 7);
    assert.equal(r.truncated, true);
    const last = await service([row("p1", "S1", false)], { total: 4 }).read({
      query: { onSale: true },
      limit: 1,
      offset: 3,
    });
    assert.equal(last.truncated, false);
  });
});

describe("notFound", () => {
  it("is empty when no identifiers were asked", () => {
    assert.deepEqual(notFound(undefined, []), []);
  });
});
