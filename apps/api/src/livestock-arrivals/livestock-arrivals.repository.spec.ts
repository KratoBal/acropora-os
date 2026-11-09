import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { liveAnimalKindSubtrees } from "../integrations/medusa/medusa-livestock.policy.js";
import { LIVESTOCK_ARRIVAL_LIMITS } from "@acropora/types";

import {
  livestockArrivalDay,
  livestockArrivalList,
  livestockArrivalView,
  livestockProductOption,
} from "./livestock-arrivals.repository.js";

/*
  WHAT TURNS THIS RED. The product picker's kind taken from anything but the category subtree (or guessed when the product sits
  under two roots or none: a wrong kind would pre-select the wrong acclimatisation advice later); a common name not trimmed or a
  blank one shown. The expected day shifting by one around midnight (a `@db.Date` column is stored as midnight UTC of the
  day: reading it through a local timezone would move the day), the product's name not reaching the list, a missing link
  shown as an empty name, a timestamp not in ISO form.
*/
const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "a1",
    kind: "CORAL",
    label: "Zoanthus csoport",
    productId: "p1",
    expectedOn: new Date("2026-11-13T00:00:00.000Z"),
    quantity: 8,
    status: "IN_TRANSIT",
    preorderable: true,
    note: null,
    createdAt: new Date("2026-11-06T08:00:00.000Z"),
    updatedAt: new Date("2026-11-06T09:30:00.000Z"),
    product: { name: "Zoanthus Utter Chaos" },
    ...over,
  }) as never;

describe("the arrival as the API shows it", () => {
  it("shows the stored day as itself, the product's name, and ISO timestamps", () => {
    const view = livestockArrivalView(row());
    assert.equal(view.expectedOn, "2026-11-13");
    assert.equal(view.productName, "Zoanthus Utter Chaos");
    assert.equal(view.createdAt, "2026-11-06T08:00:00.000Z");
    assert.equal(view.updatedAt, "2026-11-06T09:30:00.000Z");
  });

  it("a missing link has no product name (null, not an empty string)", () => {
    const view = livestockArrivalView(row({ productId: null, product: null }));
    assert.equal(view.productId, null);
    assert.equal(view.productName, null);
  });

  it("the day goes in and out unchanged, also at the edges of the year", () => {
    for (const day of [
      "2026-01-01",
      "2026-12-31",
      "2028-02-29",
      "2026-03-29",
      "2026-10-25",
    ])
      assert.equal(
        livestockArrivalView(row({ expectedOn: livestockArrivalDay(day) }))
          .expectedOn,
        day,
        day,
      );
    assert.equal(
      livestockArrivalDay("2026-11-13").toISOString(),
      "2026-11-13T00:00:00.000Z",
    );
  });
});

describe("the list's cut", () => {
  const max = LIVESTOCK_ARRIVAL_LIMITS.list.max;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => row({ id: `a${index}` }));

  it("a list at the limit is whole: nothing is flagged", () => {
    const list = livestockArrivalList(rows(max));
    assert.equal(list.items.length, max);
    assert.equal(list.truncated, false);
  });

  it("one row over the limit is dropped from the list and flagged: the query asks for one more than it shows", () => {
    const list = livestockArrivalList(rows(max + 1));
    assert.equal(list.items.length, max);
    assert.equal(list.truncated, true);
    assert.equal(list.items.at(-1)?.id, `a${max - 1}`);
  });

  it("a short or empty list is whole", () => {
    assert.deepEqual(livestockArrivalList([]), { items: [], truncated: false });
    assert.equal(livestockArrivalList(rows(3)).items.length, 3);
  });
});

describe("the product picker's options", () => {
  // Korallok > SPS; Halak > Bohóchalak; Gerinctelenek
  const subtrees = liveAnimalKindSubtrees([
    { id: "c-coral", name: "Korallok", parentId: null },
    { id: "c-sps", name: "SPS", parentId: "c-coral" },
    { id: "c-fish", name: "Halak", parentId: null },
    { id: "c-clown", name: "Bohóchalak", parentId: "c-fish" },
    { id: "c-invert", name: "Gerinctelenek", parentId: null },
  ] as never);
  const product = (categoryIds: string[], magyarNev: string | null = null) => ({
    id: "p1",
    name: "Acropora tenuis",
    datasheet: magyarNev === null ? null : { magyarNev },
    categories: categoryIds.map((categoryId) => ({ categoryId })),
  });

  it("derives the kind from the category subtree, through a child category too", () => {
    assert.equal(
      livestockProductOption(product(["c-sps"]), subtrees).kind,
      "CORAL",
    );
    assert.equal(
      livestockProductOption(product(["c-clown"]), subtrees).kind,
      "FISH",
    );
    assert.equal(
      livestockProductOption(product(["c-invert"]), subtrees).kind,
      "INVERTEBRATE",
    );
  });

  it("leaves the kind null when the product sits under more than one root, or under none of them", () => {
    assert.equal(
      livestockProductOption(product(["c-sps", "c-clown"]), subtrees).kind,
      null,
    );
    assert.equal(
      livestockProductOption(product(["elsewhere"]), subtrees).kind,
      null,
    );
    assert.equal(livestockProductOption(product([]), subtrees).kind, null);
  });

  it("carries the name and the trimmed common name, and null for a blank or missing one", () => {
    assert.deepEqual(
      livestockProductOption(product(["c-sps"], "  Tenuis korall "), subtrees),
      {
        id: "p1",
        name: "Acropora tenuis",
        commonName: "Tenuis korall",
        kind: "CORAL",
      },
    );
    assert.equal(
      livestockProductOption(product(["c-sps"], "   "), subtrees).commonName,
      null,
    );
    assert.equal(
      livestockProductOption(product(["c-sps"]), subtrees).commonName,
      null,
    );
  });
});
