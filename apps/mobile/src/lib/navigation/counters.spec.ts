import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tileBadge, tileCountLabel, type NavigationCounters } from "./counters";

/*
  A CSEMPÉK SZÁMA (4a6813db kártya). Ami pirosít:
  - a szám nem a saját csempéjén áll;
  - nullánál vagy hiányzó számnál jelvény látszik;
  - 99 fölött szétfeszíti a jelvényt;
  - a képernyőolvasó nem hallja, mit számol.
*/
const COUNTERS: NavigationCounters = {
  "service-jobs": 3,
  worksheets: 0,
  "material-requests-pending": 140,
};

describe("a csempék száma", () => {
  it("mindegyik szám a saját csempéjén", () => {
    assert.deepEqual(tileBadge("HJ", COUNTERS), {
      label: "3",
      accessibilityLabel: "3 nekem kiosztott, nyitott hibajegy",
    });
    assert.equal(tileBadge("MU", COUNTERS), null);
    assert.deepEqual(tileBadge("AI", COUNTERS), {
      label: "99+",
      accessibilityLabel: "140 teendő anyagigény",
    });
  });

  it("a nem számolt csempe és a hiányzó válasz nem ad jelvényt", () => {
    assert.equal(tileBadge("ES", COUNTERS), null);
    assert.equal(tileBadge("HJ", undefined), null);
    assert.equal(tileBadge("HJ", { ...COUNTERS, "service-jobs": null }), null);
  });

  it("a felirat", () => {
    assert.equal(tileCountLabel(0), null);
    assert.equal(tileCountLabel(null), null);
    assert.equal(tileCountLabel(99), "99");
    assert.equal(tileCountLabel(100), "99+");
  });
});
