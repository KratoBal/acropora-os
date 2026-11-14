import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideOccasionRequest, occasionsUsedOf } from "./occasion-frame.js";

/*
  EGY ALKALOM A KERETBŐL EGYSZER FOGLALÓDIK (acrobot, 2026-11-14 01:21; barracuda #2540 kérése). MI PIROSÍT: ha a
  megrendelőlap utáni lap a megrendelőlap fölé is foglal (a régi összeadó számolásnál már az első lap elbukna);
  ha a lapok sora a megrendelőlap után sem áll meg a kereten; ha egy új megrendelőlap a már elvitt alkalmakon ülne;
  ha a részben beférő kérés „elfogyott"-nak látszik; ha az alkalom nélküli tétel átmegy.
*/
describe("occasionsUsedOf", () => {
  it("a megrendelőlapok és a lapok maximuma, nem az összege", () => {
    assert.equal(occasionsUsedOf({ orders: 3, jobs: 2 }), 3);
    assert.equal(occasionsUsedOf({ orders: 1, jobs: 4 }), 4);
    assert.equal(occasionsUsedOf(undefined), 0);
  });
});

describe("decideOccasionRequest", () => {
  const order = (
    use: { orders: number; jobs: number } | undefined,
    per: number | null,
    requested = 1,
  ) =>
    decideOccasionRequest({
      use,
      occasionsPerYear: per,
      requested,
      kind: "order",
    });
  const job = (
    use: { orders: number; jobs: number } | undefined,
    per: number | null,
    requested = 1,
  ) =>
    decideOccasionRequest({
      use,
      occasionsPerYear: per,
      requested,
      kind: "job",
    });

  it("a 3 alkalmas megrendelőlap után három lap a megrendelőlap alkalmain ül, a negyedik új foglalás, és a keret ott megáll", () => {
    const fits = [0, 1, 2].map((jobs) => job({ orders: 3, jobs }, 3).fits);
    assert.deepEqual(fits, [true, true, true]);
    assert.deepEqual(job({ orders: 3, jobs: 3 }, 3), {
      fits: false,
      exhausted: true,
    });
  });

  it("megrendelőlap nélkül a lapok foglalnak: a harmadik lap után a negyedik elfogyott", () => {
    assert.equal(job({ orders: 0, jobs: 2 }, 3).fits, true);
    assert.deepEqual(job({ orders: 0, jobs: 3 }, 3), {
      fits: false,
      exhausted: true,
    });
  });

  it("a megrendelőlap saját alkalmakat foglal: a hozzáadódik a mostani felhasználáshoz", () => {
    assert.equal(order({ orders: 1, jobs: 1 }, 2, 1).fits, true);
    assert.deepEqual(order({ orders: 1, jobs: 1 }, 2, 2), {
      fits: false,
      exhausted: false,
      remaining: 1,
    });
    assert.deepEqual(order({ orders: 2, jobs: 0 }, 2), {
      fits: false,
      exhausted: true,
    });
  });

  it("az új megrendelőlap nem ül a már elvitt lapokon: három lap után az egy alkalmas megrendelőlap sem fér be (keret 3)", () => {
    assert.deepEqual(order({ orders: 0, jobs: 3 }, 3), {
      fits: false,
      exhausted: true,
    });
  });

  it("alkalom nélküli tételnek nincs kerete, és használat nélkül sem fér be semmi", () => {
    assert.deepEqual(order(undefined, null), { fits: false, exhausted: true });
    assert.deepEqual(job(undefined, null), { fits: false, exhausted: true });
  });

  it("a megadás nélküli kérés egy alkalom, és az alap fajta a megrendelőlap", () => {
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
