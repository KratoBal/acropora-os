import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isHiddenControl } from "./asset-category-prefill.js";
import {
  EXPIRY_DAYS,
  decisionReport,
  decisionReportMarkdown,
  hiddenGroup,
  rate,
  runOutcome,
  type DecisionRunRow,
  type ReportCategory,
} from "./decision-report.js";

const KULCS = "service-assets.asset-category";
const MOST = new Date("2026-10-20T12:00:00.000Z");
const NAP = 24 * 60 * 60 * 1000;

const KATEGORIAK: readonly ReportCategory[] = [
  { id: "cat_lig", name: "Világítás", code: "LIG" },
  { id: "cat_com", name: "Komputer, vezérlő", code: "COM" },
  { id: "cat_avs", name: "Akvárium szekrény", code: "AVS" },
  { id: "cat_kod_nelkul", name: "Egyéb", code: null },
];

/* A kontroll-azonositok a mar fuggetlenul tesztelt `isHiddenControl`-bol jonnek
   (a vart ertekeket ott Python szamolta): itt csak kell egy-egy mindkettobol. */
function azonositok(kontroll: boolean, db: number, elotag: string): string[] {
  const ki: string[] = [];
  for (let i = 0; ki.length < db; i++) {
    const id = `asset-create:web:${elotag}-${i}`;
    if (isHiddenControl(id, 2) === kontroll) ki.push(id);
  }
  return ki;
}
const NEM_KONTROLL = azonositok(false, 200, "n");
const KONTROLL = azonositok(true, 40, "k");

let sorszam = 0;
function futas(tobbi: Partial<DecisionRunRow> = {}): DecisionRunRow {
  sorszam++;
  return {
    id: `run-${String(sorszam).padStart(3, "0")}`,
    policyKey: KULCS,
    policyVersion: 2,
    optionsHash: "cph1:sha256:opciok",
    requestedModel: "jev-1.13.0",
    respondedModel: "jev-1.13.0",
    selectedValue: "cat_lig",
    confidence: 0.95,
    exposure: "SHOWN",
    resolution: null,
    resolvedValue: null,
    status: "OK",
    latencyMs: 300,
    errorCode: null,
    entityId: null,
    clientOperationId: NEM_KONTROLL[sorszam % NEM_KONTROLL.length] as string,
    createdAt: new Date(MOST.getTime() - NAP),
    ...tobbi,
  };
}
const kotott = (
  resolution: DecisionRunRow["resolution"],
  resolvedValue: string | null,
  tobbi: Partial<DecisionRunRow> = {},
) =>
  futas({ resolution, resolvedValue, entityId: `asset-${sorszam}`, ...tobbi });

describe("egy futás kimenetele", () => {
  it("a tárolt feloldás változatlanul jön vissza", () => {
    assert.equal(
      runOutcome(futas({ resolution: "STALE", entityId: null }), MOST),
      "STALE",
    );
    assert.equal(
      runOutcome(futas({ resolution: "EXPIRED", entityId: "a" }), MOST),
      "EXPIRED",
    );
  });

  it(`EXPIRED: ${EXPIRY_DAYS} nap után sincs eszközhöz kötve; előtte nyitott`, () => {
    const kor = (ms: number) =>
      runOutcome(
        futas({ createdAt: new Date(MOST.getTime() - ms), entityId: null }),
        MOST,
      );
    assert.equal(kor(EXPIRY_DAYS * NAP), "EXPIRED");
    assert.equal(kor(EXPIRY_DAYS * NAP - 1), "OPEN");
    assert.equal(kor(0), "OPEN");
  });

  it("eszközhöz kötve, feloldás nélkül: UNRESOLVED, a korától függetlenül", () => {
    assert.equal(
      runOutcome(
        futas({
          entityId: "asset-1",
          createdAt: new Date(MOST.getTime() - 100 * NAP),
        }),
        MOST,
      ),
      "UNRESOLVED",
    );
  });
});

describe("miért rejtett egy futás", () => {
  const k = (id: string) => KATEGORIAK.find((c) => c.id === id);
  it("NONE és hiányzó választás", () => {
    assert.equal(
      hiddenGroup({ selectedValue: "NONE", confidence: 0.99 }, undefined),
      "none",
    );
    assert.equal(
      hiddenGroup({ selectedValue: null, confidence: null }, undefined),
      "none",
    );
  });
  it("ismeretlen azonosító", () => {
    assert.equal(
      hiddenGroup({ selectedValue: "cat_torolt", confidence: 0.99 }, undefined),
      "unknown_category",
    );
  });
  it("ritka: nem validált kód, vagy kód nélküli kategória, bármilyen bizonyossággal", () => {
    assert.equal(
      hiddenGroup({ selectedValue: "cat_avs", confidence: 0.99 }, k("cat_avs")),
      "rare",
    );
    assert.equal(
      hiddenGroup(
        { selectedValue: "cat_kod_nelkul", confidence: 0.99 },
        k("cat_kod_nelkul"),
      ),
      "rare",
    );
  });
  it("validált kód 0,90 alatt: low_confidence; 0,90-en: kontroll", () => {
    assert.equal(
      hiddenGroup(
        { selectedValue: "cat_lig", confidence: 0.899 },
        k("cat_lig"),
      ),
      "low_confidence",
    );
    assert.equal(
      hiddenGroup({ selectedValue: "cat_lig", confidence: null }, k("cat_lig")),
      "low_confidence",
    );
    assert.equal(
      hiddenGroup({ selectedValue: "cat_lig", confidence: 0.9 }, k("cat_lig")),
      "control",
    );
  });
});

describe("az arány és a Wilson-intervallum", () => {
  it("a független (Python) számítás értékei", () => {
    const r = rate(8, 10);
    assert.ok(r);
    assert.equal(r.value, 0.8);
    assert.ok(Math.abs(r.ci95[0] - 0.49015684672072335) < 1e-12);
    assert.ok(Math.abs(r.ci95[1] - 0.9433190520193067) < 1e-12);
  });
  it("0/5 alsó határa 0 (a lebegőpontos -2,8e-17 nem kerül ki)", () => {
    assert.equal(rate(0, 5)?.ci95[0], 0);
  });
  it("üres nevező: nincs arány", () => {
    assert.equal(rate(0, 0), null);
  });
});

describe("a riport egy vegyes készleten", () => {
  const kontroll = (i: number) => KONTROLL[i] as string;
  const runs: DecisionRunRow[] = [
    /* SHOWN */
    kotott("ACCEPTED", "cat_lig", { confidence: 0.97 }),
    kotott("ACCEPTED", "cat_lig", { confidence: 0.96 }),
    kotott("ACCEPTED", "cat_com", {
      selectedValue: "cat_com",
      confidence: 0.91,
    }),
    kotott("OVERRIDDEN", null, { confidence: 0.99 }),
    futas({ resolution: "STALE" }),
    futas(),
    /* HIDDEN kontroll */
    kotott("SHADOW_MATCH", "cat_lig", {
      exposure: "HIDDEN",
      clientOperationId: kontroll(0),
    }),
    kotott("SHADOW_MISMATCH", "cat_com", {
      exposure: "HIDDEN",
      clientOperationId: kontroll(1),
      confidence: 0.93,
    }),
    /* HIDDEN ritka */
    kotott("SHADOW_MATCH", "cat_avs", {
      exposure: "HIDDEN",
      selectedValue: "cat_avs",
      confidence: 0.8,
    }),
    kotott("SHADOW_MISMATCH", "cat_lig", {
      exposure: "HIDDEN",
      selectedValue: "cat_avs",
      confidence: 0.6,
    }),
    futas({
      exposure: "HIDDEN",
      selectedValue: "cat_avs",
      confidence: 0.7,
      createdAt: new Date(MOST.getTime() - 20 * NAP),
    }),
    /* HIDDEN alacsony bizonyossag es NONE */
    kotott("SHADOW_MISMATCH", "cat_com", {
      exposure: "HIDDEN",
      confidence: 0.5,
    }),
    kotott("SHADOW_MISMATCH", "cat_com", {
      exposure: "HIDDEN",
      selectedValue: "NONE",
      confidence: 0.9,
    }),
    /* hibas futas */
    kotott(null, "cat_lig", {
      exposure: "HIDDEN",
      status: "ERROR",
      errorCode: "TIMEOUT",
      selectedValue: null,
      confidence: null,
      respondedModel: null,
      latencyMs: 2500,
    }),
    /* mas verzio es mas kulcs: a meroszamokba nem szamit */
    kotott("ACCEPTED", "cat_lig", { policyVersion: 1 }),
    kotott("ACCEPTED", "cat_lig", { policyKey: "mas.kulcs" }),
  ];
  const r = decisionReport({
    runs,
    categories: KATEGORIAK,
    policyKey: KULCS,
    policyVersion: 2,
    now: MOST,
  });

  it("csak a kért kulcs és verzió futásait méri", () => {
    assert.deepEqual(r.runs, { total: 14, ok: 13, error: 1 });
  });

  it("SHOWN: ACCEPTED / OVERRIDDEN, a kategória nélkül mentett külön", () => {
    assert.equal(r.shown.runs, 6);
    assert.equal(r.shown.accepted, 3);
    assert.equal(r.shown.overridden, 1);
    assert.equal(r.shown.overriddenEmpty, 1);
    assert.equal(r.shown.stale, 1);
    assert.equal(r.shown.open, 1);
    assert.equal(r.shown.acceptance?.value, 0.75);
  });

  it("HIDDEN: csoportonként", () => {
    const g = r.hidden.groups;
    assert.equal(r.hidden.runs, 7);
    assert.deepEqual([g.control.shadowMatch, g.control.shadowMismatch], [1, 1]);
    assert.deepEqual(
      [g.rare.runs, g.rare.shadowMatch, g.rare.shadowMismatch, g.rare.expired],
      [3, 1, 1, 1],
    );
    assert.deepEqual(
      [g.low_confidence.runs, g.low_confidence.shadowMismatch],
      [1, 1],
    );
    assert.deepEqual([g.none.runs, g.none.shadowMismatch], [1, 1]);
    assert.equal(g.unknown_category.runs, 0);
  });

  it("a horgonyhatás: SHOWN elfogadás mínusz kontroll egyezés", () => {
    assert.equal(r.anchoring.shownAcceptance?.value, 0.75);
    assert.equal(r.anchoring.controlMatch?.value, 0.5);
    assert.equal(r.anchoring.delta, 0.25);
  });

  it("a ritka kategória kategóriánként, kóddal és névvel", () => {
    assert.equal(r.rareCategories.length, 1);
    const avs = r.rareCategories[0];
    assert.equal(avs?.code, "AVS");
    assert.equal(avs?.name, "Akvárium szekrény");
    assert.equal(avs?.counts.runs, 3);
    assert.equal(avs?.matchRate?.value, 0.5);
    assert.ok(Math.abs((avs?.meanConfidence ?? 0) - 0.7) < 1e-12);
  });

  it("kalibráció: a sávhatárok, és a NONE kimarad", () => {
    const sav = (from: number) =>
      r.calibration.bands.find((b) => b.from === from);
    /* 0,95-1,00: 0.97, 0.96, 0.99, 0.95 (STALE), 0.95 (nyitott), 0.95 (kontroll egyezes) */
    assert.equal(sav(0.95)?.runs, 6);
    assert.deepEqual(
      [sav(0.95)?.hitRate?.hits, sav(0.95)?.hitRate?.total],
      [3, 4],
    );
    assert.deepEqual(
      [sav(0.95)?.hiddenHitRate?.hits, sav(0.95)?.hiddenHitRate?.total],
      [1, 1],
    );
    /* 0,90-0,95: 0.91 (ACCEPTED), 0.93 (kontroll elteres) -- a NONE 0,90-e nem */
    assert.equal(sav(0.9)?.runs, 2);
    assert.equal(sav(0.9)?.hitRate?.value, 0.5);
    assert.equal(sav(0.7)?.runs, 2);
    assert.equal(sav(0.5)?.runs, 2);
    assert.equal(sav(0)?.runs, 0);
    assert.equal(r.calibration.noneRuns, 1);
  });

  it("hibaarány, hibakód és késleltetés", () => {
    assert.deepEqual([r.errors.rate?.hits, r.errors.rate?.total], [1, 14]);
    assert.deepEqual(r.errors.byCode, [{ value: "TIMEOUT", runs: 1 }]);
    assert.equal(r.latency.okP95Ms, 300);
    assert.equal(r.latency.allP95Ms, 2500);
  });

  it("identitás: a kulcs minden verziója látszik, a másik kulcs nem", () => {
    assert.deepEqual(r.identity.policyVersions, [
      { value: "2", runs: 14 },
      { value: "1", runs: 1 },
    ]);
    assert.deepEqual(r.identity.requestedModels, [
      { value: "jev-1.13.0", runs: 14 },
    ]);
    assert.equal(r.identity.respondedModelMismatch, 0);
    assert.equal(r.identity.respondedModelMissing, 0);
  });

  it("STALE és EXPIRED a sikeres futásokon", () => {
    assert.deepEqual(
      [r.lifecycle.stale?.hits, r.lifecycle.stale?.total],
      [1, 13],
    );
    assert.deepEqual(
      [r.lifecycle.expired?.hits, r.lifecycle.expired?.total],
      [1, 13],
    );
    assert.equal(r.lifecycle.open, 1);
  });

  it("konzisztens készleten minden ellenőrzés nulla", () => {
    assert.deepEqual(r.consistency, {
      exposureMismatch: 0,
      missingOperationId: 0,
      okUnresolved: 0,
    });
  });

  it("a trigger még nem teljesült", () => {
    assert.deepEqual(r.trigger, {
      shownDecisions: 4,
      shownRequired: 50,
      controlDecisions: 2,
      controlRequired: 10,
      met: false,
    });
  });

  it("példák: a legbiztosabb felülírás és árnyék-eltérések, bizonyosság szerint", () => {
    assert.deepEqual(
      r.examples.map((p) => [
        p.kind,
        p.group,
        p.confidence,
        p.selected,
        p.resolved,
      ]),
      [
        ["OVERRIDDEN", "shown", 0.99, "Világítás", "(kategória nélkül)"],
        ["SHADOW_MISMATCH", "control", 0.93, "Világítás", "Komputer, vezérlő"],
        ["SHADOW_MISMATCH", "none", 0.9, "NONE", "Komputer, vezérlő"],
        ["SHADOW_MISMATCH", "rare", 0.6, "Akvárium szekrény", "Világítás"],
      ],
    );
  });

  it("a markdown a triggert és a kitöltött példanevet is mutatja", () => {
    const pelda = r.examples[0];
    assert.ok(pelda);
    pelda.name = "Kessil lámpa";
    const md = decisionReportMarkdown(r);
    assert.match(
      md,
      /SHOWN döntés \(ACCEPTED \+ OVERRIDDEN\): \*\*4 \/ 50\*\*/,
    );
    assert.match(md, /HIDDEN-kontroll döntés .*: \*\*2 \/ 10\*\*/);
    assert.match(md, /teljesült: \*\*NEM\*\*/);
    assert.match(md, /\| OVERRIDDEN \| shown \| Kessil lámpa \|/);
    assert.match(md, /különbség: \*\*25\.0 százalékpont\*\*/);
  });
});

describe("a trigger határa", () => {
  const keszlet = (shown: number, kontroll: number) => [
    ...Array.from({ length: shown }, () => kotott("ACCEPTED", "cat_lig")),
    ...Array.from({ length: kontroll }, (_, i) =>
      kotott("SHADOW_MATCH", "cat_lig", {
        exposure: "HIDDEN",
        clientOperationId: KONTROLL[i] as string,
      }),
    ),
  ];
  const teljesult = (shown: number, kontroll: number) =>
    decisionReport({
      runs: keszlet(shown, kontroll),
      categories: KATEGORIAK,
      policyKey: KULCS,
      policyVersion: 2,
      now: MOST,
    }).trigger.met;

  it("50 + 10: teljesült; 49 + 10 és 50 + 9: nem", () => {
    assert.equal(teljesult(50, 10), true);
    assert.equal(teljesult(49, 10), false);
    assert.equal(teljesult(50, 9), false);
  });

  it("a nem-kontroll rejtett egyezés nem számít a kontrollba", () => {
    const r = decisionReport({
      runs: [
        ...keszlet(50, 9),
        kotott("SHADOW_MATCH", "cat_avs", {
          exposure: "HIDDEN",
          selectedValue: "cat_avs",
        }),
      ],
      categories: KATEGORIAK,
      policyKey: KULCS,
      policyVersion: 2,
      now: MOST,
    });
    assert.equal(r.trigger.controlDecisions, 9);
    assert.equal(r.trigger.met, false);
  });
});

describe("a konzisztencia-ellenőrzés", () => {
  const riport = (runs: DecisionRunRow[]) =>
    decisionReport({
      runs,
      categories: KATEGORIAK,
      policyKey: KULCS,
      policyVersion: 2,
      now: MOST,
    });

  it("SHOWN a kontroll-azonosítóval, és HIDDEN a jogosult, nem-kontroll futáson: eltérés", () => {
    const r = riport([
      futas({ clientOperationId: KONTROLL[0] as string }),
      futas({ exposure: "HIDDEN" }),
      futas(),
    ]);
    assert.equal(r.consistency.exposureMismatch, 2);
  });

  it("a válaszoló modell eltérése és hiánya", () => {
    const r = riport([
      futas({ respondedModel: "jev-latest" }),
      futas({ respondedModel: null }),
      futas({ status: "ERROR", respondedModel: null }),
    ]);
    assert.equal(r.identity.respondedModelMismatch, 1);
    assert.equal(r.identity.respondedModelMissing, 1);
  });

  it("sikeres, kötött, feloldatlan futás: rendellenesség; hibásnál rendes", () => {
    const r = riport([
      futas({ entityId: "asset-x" }),
      futas({ entityId: "asset-y", status: "ERROR" }),
    ]);
    assert.equal(r.consistency.okUnresolved, 1);
  });
});

describe("a kalibráció sávjai", () => {
  it("az 1,00 az utolsó (zárt) sávba esik, a 0,95 is; a 0,9499 az előzőbe", () => {
    const r = decisionReport({
      runs: [
        kotott("ACCEPTED", "cat_lig", { confidence: 1 }),
        kotott("ACCEPTED", "cat_lig", { confidence: 0.95 }),
        kotott("ACCEPTED", "cat_lig", { confidence: 0.9499 }),
      ],
      categories: KATEGORIAK,
      policyKey: KULCS,
      policyVersion: 2,
      now: MOST,
    });
    assert.deepEqual(
      r.calibration.bands.map((b) => b.runs),
      [0, 0, 0, 1, 2],
    );
  });
});

describe("a példák száma", () => {
  it("alapból típusonként 3, legfeljebb 10", () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      kotott("OVERRIDDEN", "cat_com", { confidence: 0.9 + i / 1000 }),
    );
    const n = (examplesPerKind?: number) =>
      decisionReport({
        runs,
        categories: KATEGORIAK,
        policyKey: KULCS,
        policyVersion: 2,
        now: MOST,
        examplesPerKind,
      }).examples;
    assert.equal(n().length, 3);
    assert.equal(n(50).length, 10);
    assert.equal(n(0).length, 0);
    assert.equal(n()[0]?.confidence, 0.9 + 14 / 1000);
  });
});
