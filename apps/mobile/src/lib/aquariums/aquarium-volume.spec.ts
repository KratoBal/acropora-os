import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculatedVolumeLiters,
  volumeLitersFromDimensions,
} from "./aquarium-volume";

describe("calculatedVolumeLiters", () => {
  it("l × sz × m / 1000, 3 tizedesre kerekítve", () => {
    assert.equal(calculatedVolumeLiters(100, 40, 50), 200);
  });

  /**
   * KALIBRÁCIÓ: 10 × 10.5 × 10.5 / 1000 = 1.1025, ami PONTOSAN a negyedik
   * tizedesen áll. Egy csonkítás (Math.trunc) 1.102-t adna, a helyes kerekítés
   * 1.103-at -- ellenőrizve: a csonkított alakra ideiglenesen átírva a
   * függvényt pontosan ez az egy állítás lett piros, a többi nem.
   */
  it("felfelé kerekít a negyedik tizedesen, nem csonkít", () => {
    assert.equal(calculatedVolumeLiters(10, 10.5, 10.5), 1.103);
  });
});

describe("volumeLitersFromDimensions", () => {
  it("null, ha bármelyik méret hiányzik", () => {
    assert.equal(volumeLitersFromDimensions(null, 40, 50), null);
    assert.equal(volumeLitersFromDimensions(100, null, 50), null);
    assert.equal(volumeLitersFromDimensions(100, 40, null), null);
  });

  it("null, ha bármelyik méret nem pozitív", () => {
    assert.equal(volumeLitersFromDimensions(0, 40, 50), null);
    assert.equal(volumeLitersFromDimensions(-5, 40, 50), null);
  });

  it("kiszámolja, ha mind a három méret megvan", () => {
    assert.equal(volumeLitersFromDimensions(100, 40, 50), 200);
  });
});
