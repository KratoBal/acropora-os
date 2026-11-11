import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reconcileWebshopSellable,
  type SellableStore,
  type SellableStoreRow,
} from "./unas-webshop-sellable-reconcile.js";

/** The stored `Statuses` block, as the client's `nodePayload` produces it. */
const statuses = (base: string) => ({
  Status: [
    { Type: "base", Value: base },
    { Type: "plus", Id: "3", Name: "WYSIWYG", Value: "0" },
  ],
});

const row = (
  id: string,
  webshopSellable: boolean,
  base: string | null,
  inquire: string = "0",
): SellableStoreRow => ({
  id,
  name: `termek ${id}`,
  webshopSellable,
  statuses: base === null ? null : statuses(base),
  inquire,
});

const fakeStore = (rows: SellableStoreRow[]) => {
  const written: { ids: string[]; value: boolean }[] = [];
  const store: SellableStore = {
    rows: async () => rows,
    set: async (ids, value) => void written.push({ ids, value }),
  };
  return { store, written };
};

/**
 * THE STORED `webshopSellable` IS RECOMPUTED FROM THE STORED SNAPSHOT (card e1de003d). What must fail:
 * the measured case (base 2, stored false) left as it is; a dry run writing; a snapshot with no base
 * status flipped to false (it would un-publish a live product); `base` 3 or `Inquire` 1 counted as
 * sellable; a recompute that flips true rows to true, or writes rows that already agree; the scheduled
 * cap not holding; the cap holding back the flips to TRUE.
 */
describe("reconcileWebshopSellable", () => {
  it("the measured case: base 2, not inquiry-only, stored false -> true", async () => {
    const { store, written } = fakeStore([row("p1", false, "2")]);
    const result = await reconcileWebshopSellable(store, { apply: true });
    assert.equal(result.mode, "applied");
    assert.deepEqual(result.changes, [
      { id: "p1", name: "termek p1", from: false, to: true },
    ]);
    assert.deepEqual(written, [{ ids: ["p1"], value: true }]);
  });

  it("a dry run reports the changes and writes nothing", async () => {
    const { store, written } = fakeStore([
      row("p1", false, "1"),
      row("p2", true, "0"),
    ]);
    const result = await reconcileWebshopSellable(store, { apply: false });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.toTrue, 1);
    assert.equal(result.toFalse, 1);
    assert.deepEqual(written, []);
  });

  it("rows that already agree are not written, and base 3 or Inquire 1 stay not sellable", async () => {
    const { store, written } = fakeStore([
      row("ok-true", true, "1"),
      row("ok-false", false, "0"),
      row("base3", false, "3"),
      row("inquire", false, "2", "1"),
    ]);
    const result = await reconcileWebshopSellable(store, { apply: true });
    assert.equal(result.toTrue + result.toFalse, 0);
    assert.deepEqual(written, []);
    assert.equal(result.inspected, 4);
  });

  it("a snapshot with no base status is skipped and counted, never turned false", async () => {
    const { store, written } = fakeStore([row("live", true, null)]);
    const result = await reconcileWebshopSellable(store, { apply: true });
    assert.equal(result.skippedNoBaseStatus, 1);
    assert.equal(result.toFalse, 0);
    assert.deepEqual(written, []);
  });

  it("writes the two directions apart, in chunks", async () => {
    const many = Array.from({ length: 1500 }, (_, i) =>
      row(`t${i}`, false, "2"),
    );
    const { store, written } = fakeStore([...many, row("f1", true, "0")]);
    await reconcileWebshopSellable(store, { apply: true });
    const toTrue = written.filter((w) => w.value);
    assert.deepEqual(
      toTrue.map((w) => w.ids.length),
      [1000, 500],
    );
    assert.deepEqual(
      written.filter((w) => !w.value),
      [{ ids: ["f1"], value: false }],
    );
  });

  it("the scheduled cap holds ABOVE the number of flips to false, and writes nothing then", async () => {
    const flips = Array.from({ length: 3 }, (_, i) => row(`f${i}`, true, "0"));
    const { store, written } = fakeStore([...flips, row("t1", false, "2")]);
    const held = await reconcileWebshopSellable(store, {
      apply: true,
      maxToFalse: 2,
    });
    assert.equal(held.mode, "held");
    assert.match(held.heldReason ?? "", /3 products would turn not sellable/);
    assert.deepEqual(written, []);
    const atCap = await reconcileWebshopSellable(store, {
      apply: true,
      maxToFalse: 3,
    });
    assert.equal(atCap.mode, "applied");
  });

  it("the cap counts only flips to false: many flips to true are written", async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      row(`t${i}`, false, "2"),
    );
    const { store, written } = fakeStore(many);
    const result = await reconcileWebshopSellable(store, {
      apply: true,
      maxToFalse: 50,
    });
    assert.equal(result.mode, "applied");
    assert.equal(written.length, 1);
  });
});
