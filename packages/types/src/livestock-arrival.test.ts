import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIVESTOCK_ARRIVAL_KINDS,
  LIVESTOCK_ARRIVAL_KIND_LABELS,
  LIVESTOCK_ARRIVAL_LIMITS,
  LIVESTOCK_ARRIVAL_OPEN_STATUSES,
  LIVESTOCK_ARRIVAL_STATUSES,
  LIVESTOCK_ARRIVAL_STATUS_LABELS,
  isLivestockArrivalOpen,
} from "./livestock-arrival.js";
import { WEBSHOP_LIVESTOCK_KINDS } from "./webshop-acclimation.js";

/*
  WHAT TURNS THIS RED. The arrival's kinds drifting from the three the order confirmation's acclimatisation section
  tells apart (one source of truth for "what is a live animal here"); a kind or a status without its Hungarian label
  (the list would show a key); a status that may be pre-registered for although the animal is already here or the
  order is cancelled.
*/
describe("the live animal arrival's vocabulary", () => {
  it("has the same kinds as the acclimatisation section, in the same order", () => {
    assert.deepEqual(
      [...LIVESTOCK_ARRIVAL_KINDS],
      [...WEBSHOP_LIVESTOCK_KINDS],
    );
  });

  it("labels every kind and every status in Hungarian, with no gaps and no extras", () => {
    assert.deepEqual(
      Object.keys(LIVESTOCK_ARRIVAL_KIND_LABELS).sort(),
      [...LIVESTOCK_ARRIVAL_KINDS].sort(),
    );
    assert.deepEqual(
      Object.keys(LIVESTOCK_ARRIVAL_STATUS_LABELS).sort(),
      [...LIVESTOCK_ARRIVAL_STATUSES].sort(),
    );
    for (const label of [
      ...Object.values(LIVESTOCK_ARRIVAL_KIND_LABELS),
      ...Object.values(LIVESTOCK_ARRIVAL_STATUS_LABELS),
    ])
      assert.ok(label.length > 0 && !/^[A-Z_]+$/.test(label), label);
  });

  it("only an arrival that is still coming (ordered, in transit) may be registered for", () => {
    assert.deepEqual(
      [...LIVESTOCK_ARRIVAL_OPEN_STATUSES],
      ["ORDERED", "IN_TRANSIT"],
    );
    assert.equal(isLivestockArrivalOpen("ORDERED"), true);
    assert.equal(isLivestockArrivalOpen("IN_TRANSIT"), true);
    assert.equal(isLivestockArrivalOpen("ARRIVED"), false);
    assert.equal(isLivestockArrivalOpen("CANCELLED"), false);
  });

  it("keeps sane limits", () => {
    assert.ok(
      LIVESTOCK_ARRIVAL_LIMITS.label.min >= 1 &&
        LIVESTOCK_ARRIVAL_LIMITS.label.max <= 200,
    );
    assert.ok(LIVESTOCK_ARRIVAL_LIMITS.quantity.min >= 1);
  });
});
