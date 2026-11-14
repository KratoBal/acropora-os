import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideOccasionRequest, occasionsUsedOf } from "./occasion-frame.js";

/*
  AZ ÉVES ALKALOMKERET ÖSSZEADÓ MÉRCÉJE (acrobot, 2026-11-14 01:42; barracuda #2540 kérése). MI PIROSÍT: ha a
  szerződésből közvetlenül indított munkalap a megrendelőlap alkalmait használná fel (egy 3 alkalmas megrendelőlap után a
  3-as keretből mind a három lap átmenne, vagyis 6 alkalom menne ki); ha a megrendelőlapok és a lapok nem
  adódnak össze; ha a részben beférő kérés „elfogyott"-nak látszik; ha az alkalom nélküli tétel átmegy.
*/
describe("occasionsUsedOf", () => {
  it("a megrendelőlapok és a megrendelőlap nélküli lapok összege", () => {
    assert.equal(occasionsUsedOf({ orders: 3, jobs: 2 }), 5);
    assert.equal(occasionsUsedOf({ orders: 0, jobs: 4 }), 4);
    assert.equal(occasionsUsedOf(undefined), 0);
  });
});

describe("decideOccasionRequest", () => {
  const decide = (
    use: { orders: number; jobs: number } | undefined,
    per: number | null,
    requested = 1,
  ) => decideOccasionRequest({ use, occasionsPerYear: per, requested });

  it("a 3 alkalmas megrendelőlap után a 3-as keret elfogyott: az első szerződésből indított munkalap sem fér be", () => {
    assert.deepEqual(decide({ orders: 3, jobs: 0 }, 3), {
      fits: false,
      exhausted: true,
    });
  });

  it("4-es keretnél az első munkalap átmegy, a második már nem", () => {
    assert.equal(decide({ orders: 3, jobs: 0 }, 4).fits, true);
    assert.deepEqual(decide({ orders: 3, jobs: 1 }, 4), {
      fits: false,
      exhausted: true,
    });
  });

  it("megrendelőlap nélkül a munkalapok foglalnak: a harmadik után a negyedik elfogyott", () => {
    assert.equal(decide({ orders: 0, jobs: 2 }, 3).fits, true);
    assert.deepEqual(decide({ orders: 0, jobs: 3 }, 3), {
      fits: false,
      exhausted: true,
    });
  });

  it("a megrendelőlapok és a lapok összeadódnak: 1 + 1 a 2-es keretből nem hagy többet", () => {
    assert.equal(decide({ orders: 1, jobs: 1 }, 3).fits, true);
    assert.deepEqual(decide({ orders: 1, jobs: 1 }, 2), {
      fits: false,
      exhausted: true,
    });
  });

  it("a csak részben beférő kérés megnevezi a hátralévőt, nem „elfogyott”", () => {
    assert.deepEqual(decide({ orders: 1, jobs: 0 }, 2, 2), {
      fits: false,
      exhausted: false,
      remaining: 1,
    });
  });

  it("alkalom nélküli tételnek nincs kerete, és használat nélkül sem fér be semmi", () => {
    assert.deepEqual(decide(undefined, null), { fits: false, exhausted: true });
  });

  it("a megadás nélküli kérés egy alkalom", () => {
    assert.equal(
      decideOccasionRequest({
        use: { orders: 0, jobs: 0 },
        occasionsPerYear: 1,
      }).fits,
      true,
    );
    assert.deepEqual(
      decideOccasionRequest({
        use: { orders: 1, jobs: 0 },
        occasionsPerYear: 1,
      }),
      { fits: false, exhausted: true },
    );
  });
});
