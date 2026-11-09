import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, runOutDates, runOutDays } from "./run-out.js";

/*
  WHAT TURNS THIS RED (ReefClub reminder V3.2, card cd94ed11): a pack's days counted from a dose in drops, a pack size that is
  not one number and one volume unit, or a mass; the days rounded UP (a reminder that comes after the pack is empty); the
  shortest days not taken at the HIGHEST frequency; a weekly dose counted as daily; a reminder dated before the pack arrived;
  a date that does not exist accepted.
*/
function days(dose: string, packageText: string, aquariumLitres: number) {
  const r = runOutDays({ dose, packageText, aquariumLitres });
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r;
}
function refused(dose: string, packageText: string, aquariumLitres: number) {
  const r = runOutDays({ dose, packageText, aquariumLitres });
  assert.equal(
    r.ok,
    false,
    `${dose} / ${packageText} / ${aquariumLitres} should be refused`,
  );
  return r.ok ? "" : r.reason;
}

describe("how many days a pack lasts", () => {
  it("a daily dose: 5 ml per 100 L a day, a 100 ml pack, 300 L is 15 ml a day: 6 whole days, rounded down", () => {
    const r = days("5 ml/100 L/day", "100 ml", 300);
    assert.equal(r.mlPerApplication, 15);
    assert.equal(r.packageMl, 100);
    assert.deepEqual(r.days, { min: 6, max: 6 });
  });

  it("a weekly dose is counted per week, not per day", () => {
    // 1 ml per 100 L, three times a week, 200 L: 2 ml an application, 6 ml a week: 250 ml last 41 weeks and a bit (291 days)
    assert.deepEqual(days("1 ml/100 L, 3/week", "250 ml", 200).days, {
      min: 291,
      max: 291,
    });
  });

  it("a frequency range gives a range of days: the shortest at the highest frequency, the longest at the lowest", () => {
    // 2 ml an application, 1-2 a week: 250 ml last 437 days at twice a week, 875 days at once a week
    assert.deepEqual(days("1 ml/100 L, 1-2/week", "250 ml", 200).days, {
      min: 437,
      max: 875,
    });
  });

  it("a litre pack, and a dose given in litres, are both read as millilitres", () => {
    assert.equal(days("5 ml/100 L/day", "1 l", 100).packageMl, 1000);
    assert.equal(days("0.01 l/100 L/day", "100 ml", 100).mlPerApplication, 10);
  });

  it("a dose in drops is refused: a drop has no known volume", () => {
    assert.match(refused("1 drop/100 L/day", "100 ml", 300), /drops/);
  });

  it("a pack size that is not one number and one volume unit is refused, a mass included", () => {
    for (const text of [
      "100",
      "~100 ml",
      "2 x 100 ml",
      "100-250 ml",
      "500 g",
      "",
      "ml",
    ])
      assert.match(refused("5 ml/100 L/day", text, 300), /^package:/, text);
  });

  it("a dose that is not the canonical form is refused", () => {
    for (const dose of ["", "a spoonful", "max 5 ml/100 L/day", "5 ml/100 L"])
      assert.match(refused(dose, "100 ml", 300), /^dose:/, dose);
  });

  it("litres that are not a positive number up to 100 000 are refused", () => {
    for (const litres of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 100_001])
      assert.match(
        refused("5 ml/100 L/day", "100 ml", litres),
        /^aquarium:/,
        String(litres),
      );
    // the limit itself is allowed (a big pack, so that it lasts more than a day)
    assert.equal(days("5 ml/100 L/day", "1000 l", 100_000).ok, true);
  });

  it("a pack that lasts less than a day is not a reminder case", () => {
    assert.match(refused("5 ml/100 L/day", "10 ml", 1000), /less than a day/);
  });
});

describe("the dates", () => {
  it("adds days in UTC and refuses a date that does not exist", () => {
    assert.equal(addDays("2026-11-09", 30), "2026-12-09");
    assert.equal(addDays("2026-12-30", 5), "2027-01-04");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-11-09", -10), "2026-10-30");
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "26-11-09",
      "",
      "2026-11-09T00:00:00Z",
    ])
      assert.equal(addDays(bad, 1), null, bad);
  });

  it("the reminder goes a week before the earliest run-out, counted from the delivery", () => {
    assert.deepEqual(runOutDates("2026-11-09", { min: 30, max: 60 }), {
      runsOutOn: "2026-12-09",
      remindOn: "2026-12-02",
    });
  });

  it("a pack of a week or less is due on the delivery day, never before it", () => {
    assert.deepEqual(runOutDates("2026-11-09", { min: 6, max: 6 }), {
      runsOutOn: "2026-11-15",
      remindOn: "2026-11-09",
    });
  });

  it("a delivery date that does not exist gives no dates", () => {
    assert.equal(runOutDates("2026-02-30", { min: 30, max: 30 }), null);
  });
});
