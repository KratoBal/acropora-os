import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrandImportReport } from "./medusa-brand-import.service.js";
import type { BrandImportPlan } from "./medusa-brand-plan.js";
import {
  brandCollectionsFailedStep,
  brandCollectionsOffStep,
  brandCollectionsStep,
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
  handleTaken: [],
  ...over,
});
const report = (over: Partial<BrandImportReport> = {}): BrandImportReport => ({
  created: 0,
  linkedOnly: 0,
  relinked: 0,
  skipped: 0,
  skippedArchived: [],
  conflicts: [],
  handleTaken: [] as string[],
  failures: [],
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
    assert.deepEqual(await ensureBrandCollections(d), {
      status: "unchanged",
      planned: {
        create: 0,
        mapOnly: 0,
        staleMapping: 0,
        skip: 2,
        conflict: 0,
        skipArchived: 1,
        handleTaken: 0,
      },
    });
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
      planned: {
        create: 2,
        mapOnly: 1,
        staleMapping: 1,
        skip: 0,
        conflict: 0,
        skipArchived: 0,
        handleTaken: 0,
      },
      created: 2,
      linkedOnly: 1,
      relinked: 1,
      touched: 4,
      conflicts: [],
      handleTaken: [] as string[],
      failures: [],
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
      planned: {
        create: 0,
        mapOnly: 0,
        staleMapping: 0,
        skip: 0,
        conflict: 1,
        skipArchived: 0,
        handleTaken: 0,
      },
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: ["k"],
      handleTaken: [] as string[],
      failures: [],
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
      planned: {
        create: 3,
        mapOnly: 1,
        staleMapping: 0,
        skip: 0,
        conflict: 2,
        skipArchived: 0,
        handleTaken: 0,
      },
      created: 3,
      linkedOnly: 1,
      relinked: 0,
      touched: 4,
      conflicts: ["k1", "k2"],
      handleTaken: [] as string[],
      failures: [],
    });
    assert.match(sor, /3 létrehozva/);
    assert.match(sor, /4 márka megérintve/);
    assert.match(sor, /ÜTKÖZÉS, érintetlen marad: k1, k2/);
  });
});

describe("a lépés a kör állapotában (kártya ec82b629, mérhetővé tétel)", () => {
  /**
   * MI PIROSÍT: ha a rossz alakban álló kapcsoló (`True`, idézőjeles, szóközös) ugyanolyan `enabled: false` lenne, mint a hiányzó
   * (a mért eset: a lépés nem írt, és semmi nem mondta meg, miért); ha a nyers érték kikerülne; ha egy megtagadás, egy változatlan
   * és egy végrehajtott kör ugyanazt mutatná; ha a hiba szövege a határon túl hosszú vagy többsoros; ha a terv száma elveszne.
   */
  it("a kikapcsolt lépés megmondja, van-e kapcsoló, és rossz alakban áll-e (a nyers érték nem megy ki)", () => {
    assert.deepEqual(brandCollectionsOffStep({}), {
      enabled: false,
      switchPresent: false,
      switchLooksTrue: false,
    });
    for (const rossz of ["True", "TRUE", '"true"', " true ", "'true'"])
      assert.deepEqual(
        brandCollectionsOffStep({ MEDUSA_ENSURE_BRAND_COLLECTIONS: rossz }),
        { enabled: false, switchPresent: true, switchLooksTrue: true },
        rossz,
      );
    for (const mas of ["", "false", "1", "yes"])
      assert.deepEqual(
        brandCollectionsOffStep({ MEDUSA_ENSURE_BRAND_COLLECTIONS: mas }),
        { enabled: false, switchPresent: true, switchLooksTrue: false },
        mas,
      );
    assert.ok(
      !JSON.stringify(
        brandCollectionsOffStep({ MEDUSA_ENSURE_BRAND_COLLECTIONS: "titok" }),
      ).includes("titok"),
    );
  });

  it("a három eredmény három különböző érték, a tervvel együtt", () => {
    const planned = {
      create: 45,
      mapOnly: 0,
      staleMapping: 0,
      skip: 60,
      conflict: 0,
      skipArchived: 0,
      handleTaken: 0,
    };
    const valtozatlan = brandCollectionsStep({ status: "unchanged", planned });
    assert.equal(
      valtozatlan.enabled && !valtozatlan.failed && valtozatlan.status,
      "unchanged",
    );
    assert.deepEqual(
      valtozatlan.enabled && !valtozatlan.failed && valtozatlan.planned,
      planned,
    );
    const megtagadott = brandCollectionsStep({
      status: "refused",
      reason: "csonkolt",
    });
    assert.deepEqual(megtagadott, {
      enabled: true,
      failed: false,
      status: "refused",
      planned: null,
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: 0,
      handleTaken: 0,
      brandFailures: 0,
      failureSamples: [],
      reason: "csonkolt",
    });
    assert.deepEqual(
      brandCollectionsStep({
        status: "applied",
        planned,
        created: 45,
        linkedOnly: 0,
        relinked: 0,
        touched: 45,
        conflicts: ["k"],
        handleTaken: [] as string[],
        failures: [],
      }),
      {
        enabled: true,
        failed: false,
        status: "applied",
        planned,
        created: 45,
        linkedOnly: 0,
        relinked: 0,
        touched: 45,
        conflicts: 1,
        handleTaken: 0,
        brandFailures: 0,
        failureSamples: [],
        reason: null,
      },
    );
  });

  it("a hiba szövege egy sorba esik és határolt", () => {
    const lep = brandCollectionsFailedStep(
      new Error(
        "HTTP 400\n  Collection with handle x already exists " +
          "y".repeat(400),
      ),
    );
    assert.equal(lep.enabled && lep.failed, true);
    const szoveg = lep.enabled && lep.failed ? lep.error : "";
    assert.ok(szoveg.length <= 160);
    assert.ok(!szoveg.includes("\n"));
    assert.match(szoveg, /^HTTP 400 Collection with handle x/);
    assert.equal(
      brandCollectionsFailedStep("sima szöveg").enabled &&
        (brandCollectionsFailedStep("sima szöveg") as { error: string }).error,
      "sima szöveg",
    );
  });
});

/*
  A FOGLALT HANDLE ES A MARKANKENTI HIBA A LEPES JELENTESEBEN (kartya ec82b629). MI PIROSIT: ha egy foglalt handle ("fauna-marin"
  esete: a Medusan mar letezik) eltunik a jelentesbol, vagy ha onmagaban `unchanged`-nek latszik; ha egy marka hibaja nem latszik
  a lepes allapotaban (szam es az elso nehany hiba, fazissal); ha a hibak szama nem a valodi szam, hanem a mintae.
*/
describe("a foglalt handle és a márkánkénti hiba a jelentésben", () => {
  const foglalt = {
    ourId: "brand-fm",
    handle: "fauna-marin",
    medusaId: "pcol_fm",
    reason: "other-brand" as const,
  };

  it("a foglalt handle magaban nem ir, de a kor jelenti (nem unchanged)", async () => {
    const { d, calls, touched } = deps({
      p: plan({ handleTaken: [foglalt] }),
    });
    const out = await ensureBrandCollections(d);
    assert.equal(out.status, "applied");
    assert.deepEqual(out.status === "applied" && out.handleTaken, ["brand-fm"]);
    assert.deepEqual(calls, ["plan"]);
    assert.deepEqual(touched, []);
  });

  it("a betoltes jelentesenek hibai és foglalt handle-jei a kimenetben vannak", async () => {
    const { d } = deps({
      p: plan({ create: [{ ourId: "a", title: "A", handle: "a" }] }),
      r: report({
        created: 1,
        handleTaken: ["brand-fm"],
        failures: [{ ourId: "b", phase: "create", message: "HTTP 400" }],
      }),
    });
    const out = await ensureBrandCollections(d);
    assert.ok(out.status === "applied");
    assert.deepEqual(out.handleTaken, ["brand-fm"]);
    assert.deepEqual(out.failures, [
      { ourId: "b", phase: "create", message: "HTTP 400" },
    ]);
  });

  it("a napló-sor megnevezi a foglalt handle-t és a hibás márkát fázissal", () => {
    const sor = describeBrandCollections({
      status: "applied",
      planned: {
        create: 1,
        mapOnly: 0,
        staleMapping: 0,
        skip: 0,
        conflict: 0,
        skipArchived: 0,
        handleTaken: 1,
      },
      created: 1,
      linkedOnly: 0,
      relinked: 0,
      touched: 1,
      conflicts: [],
      handleTaken: ["brand-fm"],
      failures: [{ ourId: "brand-x", phase: "link", message: "m" }],
    });
    assert.match(sor, /FOGLALT HANDLE.*brand-fm/);
    assert.match(sor, /1 márkánál a művelet elbukott \(brand-x: link\)/);
  });

  it("a lépés állapota a hibák valódi számát és csak az első ötöt adja", () => {
    const failures = Array.from({ length: 8 }, (_, i) => ({
      ourId: `brand-${i}`,
      phase: "create" as const,
      message: "HTTP 400",
    }));
    const planned = {
      create: 8,
      mapOnly: 0,
      staleMapping: 0,
      skip: 0,
      conflict: 0,
      skipArchived: 0,
      handleTaken: 2,
    };
    const lep = brandCollectionsStep({
      status: "applied",
      planned,
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: [],
      handleTaken: ["x", "y"],
      failures,
    });
    assert.ok(lep.enabled && !lep.failed);
    if (lep.enabled && !lep.failed) {
      assert.equal(lep.brandFailures, 8);
      assert.equal(lep.failureSamples.length, 5);
      assert.deepEqual(lep.failureSamples[0], failures[0]);
      assert.equal(lep.handleTaken, 2);
    }
  });
});
