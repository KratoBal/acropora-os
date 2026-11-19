import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
} from "./medusa-admin.client.js";

/*
  THE FIVE PRICE LIST CALLS (card 54bb3779). WHAT TURNS RED: a list found by anything but its exact key (a hand-made list
  named alike would be changed or deleted); the list created without type sale, status active, the key as description,
  the variant's price and the window in ISO; a patch that sends a field it was not given (a missing end would be cleared)
  or cannot clear a border (null); the batch not carrying the variant and currency on the rows, or the delete ids; a refused
  call not arriving as an HTTP error.
*/
type Sent = { url: string; method: string; body: unknown };
const clientOf = (status: number, answer: unknown, sent: Sent[]) =>
  new HttpMedusaAdminClient(
    { baseUrl: "https://shop.test", apiKey: "k" },
    (async (url: string, init?: RequestInit) => {
      sent.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(answer), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  );

describe("findSaleLists", () => {
  it("searches by the key and keeps only the exact description", async () => {
    const sent: Sent[] = [];
    const rows = [
      {
        id: "a",
        description: "os-sale:v1",
        status: "active",
        starts_at: null,
        ends_at: null,
      },
      {
        id: "b",
        description: "os-sale:v1 (kézi)",
        status: "active",
        starts_at: null,
        ends_at: null,
      },
      {
        id: "c",
        description: "os-sale:v10",
        status: "active",
        starts_at: null,
        ends_at: null,
      },
    ];
    const found = await clientOf(
      200,
      { price_lists: rows },
      sent,
    ).findSaleLists("os-sale:v1");
    assert.deepEqual(
      found.map((row) => row.id),
      ["a"],
    );
    const url = new URL(sent[0]!.url);
    assert.equal(url.pathname, "/admin/price-lists");
    assert.equal(url.searchParams.get("q"), "os-sale:v1");
    assert.ok(url.searchParams.get("fields")!.includes("*prices"));
  });
});

describe("createSaleList", () => {
  it("posts a sale list in force with the key, one price and the window in ISO", async () => {
    const sent: Sent[] = [];
    const row = {
      id: "plist_1",
      status: "active",
      starts_at: null,
      ends_at: null,
    };
    const made = await clientOf(200, { price_list: row }, sent).createSaleList({
      key: "os-sale:v1",
      title: "OS akció: SKU1",
      variantId: "v1",
      amount: 69600,
      currencyCode: "huf",
      startsAt: new Date("2026-11-19T00:00:00.000Z"),
      endsAt: null,
    });
    assert.equal(made.id, "plist_1");
    assert.equal(sent[0]!.url, "https://shop.test/admin/price-lists");
    assert.equal(sent[0]!.method, "POST");
    assert.deepEqual(sent[0]!.body, {
      title: "OS akció: SKU1",
      description: "os-sale:v1",
      type: "sale",
      status: "active",
      starts_at: "2026-11-19T00:00:00.000Z",
      ends_at: null,
      metadata: { acropora_os_sale: true },
      prices: [{ variant_id: "v1", currency_code: "huf", amount: 69600 }],
    });
  });
});

describe("updateSaleList", () => {
  it("sends only the given fields, and null clears a border", async () => {
    const sent: Sent[] = [];
    const client = clientOf(200, {}, sent);
    await client.updateSaleList("plist_1", {
      endsAt: new Date("2026-11-30T22:59:00.000Z"),
    });
    await client.updateSaleList("plist_1", {
      startsAt: null,
      status: "active",
    });
    await client.updateSaleList("plist_1", {});
    assert.equal(sent[0]!.url, "https://shop.test/admin/price-lists/plist_1");
    assert.deepEqual(sent[0]!.body, { ends_at: "2026-11-30T22:59:00.000Z" });
    assert.deepEqual(sent[1]!.body, { starts_at: null, status: "active" });
    assert.deepEqual(sent[2]!.body, {});
  });
});

describe("batchSaleListPrices", () => {
  it("carries the variant and the currency on every row, and the delete ids", async () => {
    const sent: Sent[] = [];
    await clientOf(200, {}, sent).batchSaleListPrices("plist_1", {
      variantId: "v1",
      currencyCode: "huf",
      create: [{ amount: 100 }],
      update: [{ id: "lp_1", amount: 90 }],
      delete: ["lp_2"],
    });
    assert.equal(
      sent[0]!.url,
      "https://shop.test/admin/price-lists/plist_1/prices/batch",
    );
    assert.deepEqual(sent[0]!.body, {
      create: [{ variant_id: "v1", currency_code: "huf", amount: 100 }],
      update: [
        { id: "lp_1", variant_id: "v1", currency_code: "huf", amount: 90 },
      ],
      delete: ["lp_2"],
    });
  });
});

describe("deleteSaleList and a refusal", () => {
  it("deletes by id, and a refused call is an HTTP error with the shop's body", async () => {
    const sent: Sent[] = [];
    await clientOf(200, {}, sent).deleteSaleList("plist_1");
    assert.equal(sent[0]!.method, "DELETE");
    assert.equal(sent[0]!.url, "https://shop.test/admin/price-lists/plist_1");
    await assert.rejects(
      () => clientOf(404, { message: "nincs" }, []).deleteSaleList("x"),
      (error: unknown) =>
        error instanceof MedusaAdminHttpError && error.status === 404,
    );
  });
});
