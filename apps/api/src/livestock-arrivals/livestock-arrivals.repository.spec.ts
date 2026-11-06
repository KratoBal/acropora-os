import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  livestockArrivalDay,
  livestockArrivalView,
} from "./livestock-arrivals.repository.js";

/*
  WHAT TURNS THIS RED. The expected day shifting by one around midnight (a `@db.Date` column is stored as midnight UTC of the
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
