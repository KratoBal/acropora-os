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
    assert.deepEqual(planSaleList(null, null), { kind: "none" });
  });

  it("nothing wanted and a list there: delete it", () => {
    assert.deepEqual(planSaleList(existing(), null), {
      kind: "delete",
      listId: "plist_1",
    });
  });

  it("a sale wanted and no list: create it with the wanted sale", () => {
    assert.deepEqual(planSaleList(null, wanted()), {
      kind: "create",
      wanted: wanted(),
    });
  });

  it("a list that is already as wanted: unchanged, whatever notation the dates come in", () => {
    assert.deepEqual(planSaleList(existing(), wanted()), {
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
      ),
      { kind: "unchanged", listId: "plist_1" },
    );
  });

  it("an open window on both sides matches a list with no dates", () => {
    assert.deepEqual(
      planSaleList(
        existing({ startsAt: null, endsAt: null }),
        wanted({ startsAt: null, endsAt: null }),
      ),
      { kind: "unchanged", listId: "plist_1" },
    );
  });

  it("a changed price updates the row in place (its id stays), and nothing else", () => {
    const plan = planSaleList(existing(), wanted({ amount: 59990 }));
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
    const moved = planSaleList(existing(), wanted({ endsAt: later }));
    assert.ok(moved.kind === "update");
    assert.deepEqual(moved.list, { endsAt: later });
    assert.deepEqual(moved.prices, { create: [], update: [], delete: [] });
    const open = planSaleList(existing(), wanted({ endsAt: null }));
    assert.ok(open.kind === "update");
    assert.deepEqual(open.list, { endsAt: null });
  });

  it("a draft list is switched to active", () => {
    const plan = planSaleList(existing({ status: "draft" }), wanted());
    assert.ok(plan.kind === "update");
    assert.deepEqual(plan.list, { status: "active" });
  });

  it("a list with no price row gets one, an extra row or another currency's row goes", () => {
    const empty = planSaleList(existing({ prices: [] }), wanted());
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
    );
    assert.ok(extra.kind === "update");
    assert.deepEqual(extra.prices.delete, ["lp_2", "lp_3"]);
    assert.deepEqual(extra.prices.update, []);
  });
});
