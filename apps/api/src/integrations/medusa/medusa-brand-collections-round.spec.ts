import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrandImportReport } from "./medusa-brand-import.service.js";
import type { BrandImportPlan } from "./medusa-brand-plan.js";
import {
  describeBrandCollections,
  ensureBrandCollections,
  ensureBrandCollectionsInRound,
  type BrandCollectionsDeps,
} from "./medusa-brand-collections-round.js";

/*
  A HIÁNYZÓ MÁRKA-GYŰJTEMÉNYEK BIZTOSÍTÁSA (kártya ec82b629). MI PIROSIT: a lépés kapcsoló nélkül bekapcsolva; ha nincs mit
  csinálni, mégis ír vagy megérint; ha a betöltés után a létrejött márkák nem lesznek megérintve (a termékeik nem lesznek
  esedékesek); ha egy félig lefutott betöltés a már leképezett márkákat megérintés nélkül hagyja (a következő kör már
  "áll"-nak látja őket); ha a még le nem képezett márka is esedékes lesz; ha egy ütközés eltűnik a jelentésből; ha a csonkolt
  lista megtagadása hibává válik; ha a megérintés a betöltés ELŐTT történik.
*/
const plan = (over: Partial<BrandImportPlan> = {}): BrandImportPlan => ({
  create: [],
  mapOnly: [],
  skip: [],
  staleMapping: [],
  conflict: [],
  skipArchived: [],
  ...over,
});
const report = (over: Partial<BrandImportReport> = {}): BrandImportReport => ({
  created: 0,
  linkedOnly: 0,
  relinked: 0,
  skipped: 0,
  skippedArchived: [],
  conflicts: [],
  verification: { carryingOurId: 0, mappingRowsHere: 0, expected: 0 },
  ...over,
});
const NOW = new Date("2026-11-19T10:00:00.000Z");

function deps(
  over: Partial<BrandCollectionsDeps> & {
    p?: BrandImportPlan;
    r?: BrandImportReport;
  } = {},
) {
  const calls: string[] = [];
  const touched: { ids: string[]; now: Date }[] = [];
  const d: BrandCollectionsDeps = {
    plan: async () => {
      calls.push("plan");
      return over.p ?? plan();
    },
    apply: async () => {
      calls.push("apply");
      return over.r ?? report();
    },
    mappedAmong: async (ids) => {
      calls.push("mapped");
      return ids;
    },
    touchBrands: async (ids, now) => {
      calls.push("touch");
      touched.push({ ids, now });
      return ids.length;
    },
    now: () => NOW,
    refusedReason: () => null,
    ...over,
  };
  return { d, calls, touched };
}
const create = (ourId: string) => ({ ourId, title: ourId, handle: ourId });

describe("ensureBrandCollectionsInRound", () => {
  it("csak a pontos true kapcsolja be, alapból KI", () => {
    assert.equal(ensureBrandCollectionsInRound({}), false);
    for (const v of ["1", "yes", "TRUE", "on", ""])
      assert.equal(
        ensureBrandCollectionsInRound({ MEDUSA_ENSURE_BRAND_COLLECTIONS: v }),
        false,
      );
    assert.equal(
      ensureBrandCollectionsInRound({
        MEDUSA_ENSURE_BRAND_COLLECTIONS: "true",
      }),
      true,
    );
  });
});

describe("ensureBrandCollections", () => {
  it("ha nincs mit létrehozni vagy leképezni, nem ír és nem érint meg semmit", async () => {
    const { d, calls } = deps({
      p: plan({ skip: ["a", "b"], skipArchived: ["x"] }),
    });
    assert.deepEqual(await ensureBrandCollections(d), { status: "unchanged" });
    assert.deepEqual(calls, ["plan"]);
  });

  it("létrehoz, majd megérinti a létrejött és leképezett márkákat, a betöltés UTÁN", async () => {
    const { d, calls, touched } = deps({
      p: plan({
        create: [create("a"), create("b")],
        mapOnly: [{ ourId: "c", medusaId: "col_c" }],
        staleMapping: ["d"],
      }),
      r: report({ created: 2, linkedOnly: 1, relinked: 1 }),
    });
    const out = await ensureBrandCollections(d);
    assert.deepEqual(calls, ["plan", "apply", "mapped", "touch"]);
    assert.deepEqual(touched, [{ ids: ["a", "b", "c", "d"], now: NOW }]);
    assert.deepEqual(out, {
      status: "applied",
      created: 2,
      linkedOnly: 1,
      relinked: 1,
      touched: 4,
      conflicts: [],
    });
  });

  it("a megérintés csak azokra megy, amiknek a leképezése MOST megvan", async () => {
    const { d, touched } = deps({
      p: plan({ create: [create("a"), create("b")] }),
      r: report({ created: 2 }),
      mappedAmong: async () => ["a"],
    });
    const out = await ensureBrandCollections(d);
    assert.deepEqual(touched[0]!.ids, ["a"]);
    assert.equal(out.status === "applied" && out.touched, 1);
  });

  it("egy félig lefutott betöltés után a már leképezetteket megérinti, és a hibát továbbadja", async () => {
    const { d, touched } = deps({
      p: plan({ create: [create("a"), create("b"), create("c")] }),
      apply: async () => {
        throw new Error("HTTP 502 a 2. gyűjteménynél");
      },
      mappedAmong: async () => ["a"],
    });
    await assert.rejects(ensureBrandCollections(d), /HTTP 502/);
    assert.deepEqual(touched, [{ ids: ["a"], now: NOW }]);
  });

  it("a megérintés hibája nem fedi el a betöltés hibáját", async () => {
    const { d } = deps({
      p: plan({ create: [create("a")] }),
      apply: async () => {
        throw new Error("betöltés hiba");
      },
      touchBrands: async () => {
        throw new Error("adatbázis hiba");
      },
    });
    await assert.rejects(ensureBrandCollections(d), /betöltés hiba/);
  });

  it("egy ütközés önmagában nem ír, de minden körben megjelenik a jelentésben", async () => {
    const { d, calls } = deps({
      p: plan({
        conflict: [
          { ourId: "k", mappedMedusaId: "x", medusaIdCarryingOurId: "y" },
        ] as never,
      }),
    });
    const out = await ensureBrandCollections(d);
    assert.deepEqual(out, {
      status: "applied",
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: ["k"],
    });
    assert.deepEqual(calls, ["plan"]);
  });

  it("a betöltés jelentésének ütközései is átjönnek", async () => {
    const { d } = deps({
      p: plan({ create: [create("a")] }),
      r: report({ created: 1, conflicts: ["k"] }),
    });
    const out = await ensureBrandCollections(d);
    assert.equal(out.status === "applied" && out.conflicts[0], "k");
  });

  it("a csonkolt lista megtagadása megállás (refused), nem hiba, és nem ír", async () => {
    const { d, calls } = deps({
      plan: async () => {
        throw new Error("MEDUSA_BRAND_IMPORT_REFUSED: csonkolt");
      },
      refusedReason: (e) =>
        e instanceof Error && /REFUSED/.test(e.message) ? "csonkolt" : null,
    });
    assert.deepEqual(await ensureBrandCollections(d), {
      status: "refused",
      reason: "csonkolt",
    });
    assert.deepEqual(calls, []);
  });

  it("minden más terv-hiba hiba marad", async () => {
    const { d } = deps({
      plan: async () => {
        throw new Error("HTTP 500");
      },
    });
    await assert.rejects(ensureBrandCollections(d), /HTTP 500/);
  });
});

describe("describeBrandCollections", () => {
  it("megnevezi a számokat és az ütközést", () => {
    const sor = describeBrandCollections({
      status: "applied",
      created: 3,
      linkedOnly: 1,
      relinked: 0,
      touched: 4,
      conflicts: ["k1", "k2"],
    });
    assert.match(sor, /3 létrehozva/);
    assert.match(sor, /4 márka megérintve/);
    assert.match(sor, /ÜTKÖZÉS, érintetlen marad: k1, k2/);
  });
});
