import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  digitsOf,
  digitsToHu,
  huToIso,
  inRange,
  isoToHu,
  nextText,
} from "./hu-date.js";

// What must fail: a date shown in the browser's order (11/03/2026) instead of the Hungarian
// one; February 30 accepted; a half-typed date handed to the caller as a date; the trailing
// dot making a delete impossible; a pasted ISO / dotted / Hungarian date read differently.
describe("the Hungarian date text", () => {
  it("shows an ISO date as year, month, day with dots", () => {
    assert.equal(isoToHu("2026-11-03"), "2026. 11. 03.");
    assert.equal(isoToHu("2024-02-29"), "2024. 02. 29.");
  });

  it("shows nothing for an empty or impossible date", () => {
    assert.equal(isoToHu(""), "");
    assert.equal(isoToHu(undefined), "");
    assert.equal(isoToHu("2026-02-30"), "");
    assert.equal(isoToHu("2026-13-01"), "");
    assert.equal(isoToHu("11/03/2026"), "");
  });

  it("formats while typing, with the closing dot only after a full day", () => {
    assert.equal(digitsToHu("2026"), "2026");
    assert.equal(digitsToHu("20261"), "2026. 1");
    assert.equal(digitsToHu("202611"), "2026. 11");
    assert.equal(digitsToHu("2026110"), "2026. 11. 0");
    assert.equal(digitsToHu("20261103"), "2026. 11. 03.");
    assert.equal(digitsToHu("202611031234"), "2026. 11. 03.");
  });
});

describe("reading the typed or pasted text", () => {
  it("reads the three pasted shapes the same way", () => {
    for (const text of ["2026-11-03", "2026.11.03", "2026. 11. 03."])
      assert.equal(huToIso(text), "2026-11-03", text);
  });

  it("gives nothing for a half date or a date the calendar does not have", () => {
    assert.equal(huToIso("2026. 11. 0"), null);
    assert.equal(huToIso("2026. 02. 30."), null);
    assert.equal(huToIso("2025. 02. 29."), null);
    assert.equal(huToIso(""), null);
    assert.equal(huToIso("2024. 02. 29."), "2024-02-29");
  });

  it("keeps only the digits, at most eight", () => {
    assert.equal(digitsOf("a2b0c2d6-1x1.03zz99"), "20261103");
  });
});

describe("the bounds", () => {
  it("accepts the bounds themselves and rejects outside them", () => {
    assert.equal(inRange("2026-11-03", "2026-11-03", "2026-11-03"), true);
    assert.equal(inRange("2026-11-04", undefined, "2026-11-03"), false);
    assert.equal(inRange("2026-11-02", "2026-11-03", undefined), false);
    assert.equal(inRange("1999-01-01"), true);
  });
});

describe("editing the text", () => {
  it("a deleted dot also takes the last digit, so the delete does not stick", () => {
    assert.equal(nextText("2026. 11. 03.", "2026. 11. 03"), "2026. 11. 0");
    assert.equal(nextText("2026. 11", "2026. 11"), "2026. 11");
  });

  it("a normal delete or typed digit follows the text", () => {
    assert.equal(nextText("2026. 11. 0", "2026. 11. "), "2026. 11");
    assert.equal(nextText("2026. 1", "2026. 11"), "2026. 11");
  });
});
