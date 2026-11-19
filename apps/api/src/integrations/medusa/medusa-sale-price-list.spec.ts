import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planSaleList,
  saleListKey,
  type ExistingSaleList,
  type WantedSale,
} from "./medusa-sale-price-list.js";

/*
  THE SALE PRICE LIST PLANNER (card 54bb3779). WHAT TURNS RED: a list created when one already stands (a second list under
  one key); a list left standing when the sale is gone; an unchanged list rewritten on every run; an update that deletes
  and recreates (the variant would have no list between the two calls); an update that sends the fields that did not
  change; dates compared as text (the same instant in another notation is a change); a draft list left draft; a second
  price row or another currency's row kept on a list that holds one price.
*/
const START = new Date("2026-11-19T00:00:00.000Z");
const END = new Date("2026-11-22T22:59:00.000Z");
const wanted = (over: Partial<WantedSale> = {}): WantedSale => ({
  amount: 69600,
  startsAt: START,
  endsAt: END,
  ...over,
});
const existing = (over: Partial<ExistingSaleList> = {}): ExistingSaleList => ({
  id: "plist_1",
  status: "active",
  startsAt: START.toISOString(),
  endsAt: END.toISOString(),
  prices: [{ id: "lp_1", variantId: "v1", currencyCode: "huf", amount: 69600 }],
  ...over,
});

describe("the key", () => {
  it("is the variant id under a prefix nothing else uses", () => {
    assert.equal(saleListKey("variant_1"), "os-sale:variant_1");
  });
});

describe("planSaleList", () => {
  it("nothing wanted and nothing there: nothing", () => {
    assert.deepEqual(planSaleList(null, null, "v1"), { kind: "none" });
  });

  it("nothing wanted and a list there: delete it", () => {
    assert.deepEqual(planSaleList(existing(), null, "v1"), {
      kind: "delete",
      listId: "plist_1",
    });
  });

  it("a sale wanted and no list: create it with the wanted sale", () => {
    assert.deepEqual(planSaleList(null, wanted(), "v1"), {
      kind: "create",
      wanted: wanted(),
    });
  });

  it("a list that is already as wanted: unchanged, whatever notation the dates come in", () => {
    assert.deepEqual(planSaleList(existing(), wanted(), "v1"), {
      kind: "unchanged",
      listId: "plist_1",
    });
    assert.deepEqual(
      planSaleList(
        existing({
          startsAt: "2026-11-19T02:00:00.000+02:00",
          endsAt: "2026-11-22T22:59:00Z",
        }),
        wanted(),
        "v1",
      ),
      { kind: "unchanged", listId: "plist_1" },
    );
  });

  it("an open window on both sides matches a list with no dates", () => {
    assert.deepEqual(
      planSaleList(
        existing({ startsAt: null, endsAt: null }),
        wanted({ startsAt: null, endsAt: null }),
        "v1",
      ),
      { kind: "unchanged", listId: "plist_1" },
    );
  });

  it("a changed price updates the row in place (its id stays), and nothing else", () => {
    const plan = planSaleList(existing(), wanted({ amount: 59990 }), "v1");
    assert.deepEqual(plan, {
      kind: "update",
      listId: "plist_1",
      list: {},
      prices: {
        create: [],
        update: [{ id: "lp_1", amount: 59990 }],
        delete: [],
      },
    });
  });

  it("a moved end sends only the end, and an end that went open sends null", () => {
    const later = new Date("2026-11-30T22:59:00.000Z");
    const moved = planSaleList(existing(), wanted({ endsAt: later }), "v1");
    assert.ok(moved.kind === "update");
    assert.deepEqual(moved.list, { endsAt: later });
    assert.deepEqual(moved.prices, { create: [], update: [], delete: [] });
    const open = planSaleList(existing(), wanted({ endsAt: null }), "v1");
    assert.ok(open.kind === "update");
    assert.deepEqual(open.list, { endsAt: null });
  });

  it("a draft list is switched to active", () => {
    const plan = planSaleList(existing({ status: "draft" }), wanted(), "v1");
    assert.ok(plan.kind === "update");
    assert.deepEqual(plan.list, { status: "active" });
  });

  it("a list with no price row gets one, an extra row or another currency's row goes", () => {
    const empty = planSaleList(existing({ prices: [] }), wanted(), "v1");
    assert.ok(empty.kind === "update");
    assert.deepEqual(empty.prices, {
      create: [{ amount: 69600 }],
      update: [],
      delete: [],
    });
    const extra = planSaleList(
      existing({
        prices: [
          { id: "lp_1", variantId: "v1", currencyCode: "huf", amount: 69600 },
          { id: "lp_2", variantId: "v1", currencyCode: "huf", amount: 1 },
          { id: "lp_3", variantId: "v1", currencyCode: "eur", amount: 3 },
        ],
      }),
      wanted(),
      "v1",
    );
    assert.ok(extra.kind === "update");
    assert.deepEqual(extra.prices.delete, ["lp_2", "lp_3"]);
    assert.deepEqual(extra.prices.update, []);
  });

  it("a row for ANOTHER variant on our list is not ours: it goes, and our variant's row is created or kept (barracuda, #2733)", () => {
    // only a stranger's row on the list: ours is missing, the stranger's is deleted, nothing of it is rewritten
    const onlyStranger = planSaleList(
      existing({
        prices: [
          { id: "lp_x", variantId: "v_other", currencyCode: "huf", amount: 5 },
        ],
      }),
      wanted(),
      "v1",
    );
    assert.ok(onlyStranger.kind === "update");
    assert.deepEqual(onlyStranger.prices, {
      create: [{ amount: 69600 }],
      update: [],
      delete: ["lp_x"],
    });
    // the stranger's row first and ours second: ours is the one kept, and only the stranger's goes
    const both = planSaleList(
      existing({
        prices: [
          { id: "lp_x", variantId: "v_other", currencyCode: "huf", amount: 5 },
          { id: "lp_1", variantId: "v1", currencyCode: "huf", amount: 69600 },
        ],
      }),
      wanted(),
      "v1",
    );
    assert.ok(both.kind === "update");
    assert.deepEqual(both.prices, { create: [], update: [], delete: ["lp_x"] });
  });

  it("a row that does not say its variant stays ours by the currency", () => {
    const plan = planSaleList(
      existing({
        prices: [
          { id: "lp_1", variantId: null, currencyCode: "huf", amount: 69600 },
        ],
      }),
      wanted(),
      "v1",
    );
    assert.deepEqual(plan, { kind: "unchanged", listId: "plist_1" });
  });
});
