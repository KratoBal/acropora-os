import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NONE_KEY,
  evaluate,
  parseGoldenCsv,
  technicalGate,
  type CategoryOption,
  type Evaluated,
  type GoldenItem,
} from "./evaluation.js";

const KATEGORIAK: CategoryOption[] = [
  { id: "c_szivattyu", name: "Szivattyú", code: "SZI" },
  { id: "c_lampa", name: "Lámpa", code: "LAM" },
  { id: "c_szuro", name: "Szűrő, mechanikai", code: null },
];

describe("az arany készlet beolvasása", () => {
  /** A cimkezo tabla alakja (acrobot, 2026-09-28): pontosvesszo, BOM, nevek. */
  it("a címkéző tábla: név, kód és azonosító is feloldódik, a vesszős név is", () => {
    const csv = [
      "﻿sor;Jev_latja_nev;HELYES_KATEGORIA;ELFOGADHATO_MEG;ELDONTHETO_A_BAL_OLDALI_ADATBOL (igen/nem);megjegyzes;asset_id",
      "1;Szivattyú;Szivattyú;;igen;;a1",
      '2;"Szűrő; mechanikai";Szűrő, mechanikai;LAM|c_szivattyu;igen;;a2',
      "3;Doboz;;;nem;nem látszik;a3",
      "4;Valami;;;;;a4",
    ].join("\r\n");
    const r = parseGoldenCsv(csv, KATEGORIAK);
    assert.deepEqual(r.errors, []);
    assert.equal(r.unlabeled, 1);
    assert.deepEqual(
      r.items.map((i) => ({ ...i, accepted: [...i.accepted].sort() })),
      [
        {
          assetId: "a1",
          primary: "c_szivattyu",
          accepted: ["c_szivattyu"],
          unresolvable: false,
        },
        {
          assetId: "a2",
          primary: "c_szuro",
          accepted: ["c_lampa", "c_szivattyu", "c_szuro"],
          unresolvable: false,
        },
        { assetId: "a3", primary: null, accepted: [], unresolvable: true },
      ],
    );
  });

  it("ismeretlen kategória hiba, nem csendes kimaradás", () => {
    const csv = "asset_id;HELYES_KATEGORIA;ELDONTHETO\na1;Nincsilyen;igen\n";
    const r = parseGoldenCsv(csv, KATEGORIAK);
    assert.equal(r.items.length, 0);
    assert.match(r.errors[0] ?? "", /Nincsilyen/);
  });

  it("a hiányzó kötelező oszlopot megnevezi", () => {
    const r = parseGoldenCsv("asset_id;valami\na1;x\n", KATEGORIAK);
    assert.match(r.errors[0] ?? "", /HELYES_KATEGORIA/);
  });
});

const elem = (
  id: string,
  accepted: string[],
  unresolvable = false,
): GoldenItem => ({
  assetId: id,
  primary: accepted[0] ?? null,
  accepted: new Set(accepted),
  unresolvable,
});
const jo = (choice: string, confidence: number, latencyMs = 300) =>
  ({ ok: true, choice, confidence, latencyMs }) as const;

describe("a G pont mérőszámai", () => {
  /*
    EGY KEZZEL VEGIGSZAMOLT KESZLET: minden meroszam erteke a sorokbol
    kiszamolhato, tehat a teszt nem a fuggveny sajat kimenetet ismetli.

      e1  c_sz  jo, 0.95      kuszob felett, helyes
      e2  c_sz  c_lampa 0.93  kuszob felett, HIBAS
      e3  c_la  jo, 0.50      kuszob alatt, helyes
      e4  c_la  NONE 0.99     NONE (nem kuszob feletti javaslat), nem helyes
      e5  UNRES NONE 0.80     eldonthetetlen, NONE -> helyes
      e6  UNRES c_sz 0.95     eldonthetetlen, biztos kategoria -> magas biz. HIBA
      e7  c_sz  szolg. hiba
  */
  const eredmenyek: Evaluated[] = [
    {
      item: elem("e1", ["c_szivattyu"]),
      outcome: jo("c_szivattyu", 0.95, 100),
    },
    { item: elem("e2", ["c_szivattyu"]), outcome: jo("c_lampa", 0.93, 200) },
    { item: elem("e3", ["c_lampa"]), outcome: jo("c_lampa", 0.5, 300) },
    { item: elem("e4", ["c_lampa"]), outcome: jo(NONE_KEY, 0.99, 400) },
    { item: elem("e5", [], true), outcome: jo(NONE_KEY, 0.8, 500) },
    { item: elem("e6", [], true), outcome: jo("c_szivattyu", 0.95, 600) },
    {
      item: elem("e7", ["c_szivattyu"]),
      outcome: { ok: false, errorCode: "PROVIDER_ERROR" },
    },
  ];
  const m = evaluate(eredmenyek, 0.9);

  it("darabszámok és szolgáltatói hiba", () => {
    assert.deepEqual(
      [m.items, m.resolvable, m.unresolvable, m.providerErrors],
      [7, 5, 2, 1],
    );
    assert.equal(m.providerErrorRate, 1 / 7);
  });

  it("összesített egyezés: az eldönthető, sikeres elemeken (e1, e3 / 4)", () => {
    assert.equal(m.overallAgreement, 2 / 4);
  });

  it("lefedettség a küszöbnél: nem-NONE és ≥ 0,9 az eldönthetőkön (e1, e2 / 4)", () => {
    assert.equal(m.coverageAtThreshold, 2 / 4);
  });

  it("pontosság a küszöbnél: a küszöb feletti javaslatok közül a helyesek (e1 / e1, e2, e6)", () => {
    assert.equal(m.accuracyAtThreshold, 1 / 3);
  });

  it("magas bizonyosságú hiba: e2 és az eldönthetetlen e6", () => {
    assert.equal(m.highConfidenceErrors, 2);
    assert.equal(m.highConfidenceErrorRate, 2 / 6);
  });

  it("NONE vagy alacsony bizonyosság az eldönthetetleneken (e5 / e5, e6)", () => {
    assert.equal(m.noneOrLowOnUnresolvable, 1 / 2);
  });

  it("késleltetés: p50 és p95 a sikeres hívásokon", () => {
    assert.equal(m.latencyP50Ms, 300);
    assert.equal(m.latencyP95Ms, 600);
  });

  it("kategóriánkénti precision/recall csak legalább 8 arany-elemnél", () => {
    assert.deepEqual(m.perCategory, []);
    const sok: Evaluated[] = Array.from({ length: 8 }, (_, i) => ({
      item: elem(`s${i}`, ["c_szivattyu"]),
      outcome: jo(i < 6 ? "c_szivattyu" : "c_lampa", 0.95),
    }));
    const tobb = evaluate([
      ...sok,
      { item: elem("l1", ["c_lampa"]), outcome: jo("c_szivattyu", 0.95) },
    ]);
    assert.deepEqual(tobb.perCategory, [
      {
        categoryId: "c_szivattyu",
        goldItems: 8,
        recall: 6 / 8,
        precision: 6 / 7,
      },
    ]);
  });

  it("a technikai kapu: a fenti készlet elbukik, a hiányzó adat nem dönthető el", () => {
    const kapu = technicalGate(m);
    assert.equal(
      kapu.find((g) => g.metric === "accuracyAtThreshold")?.pass,
      false,
    );
    assert.equal(kapu.find((g) => g.metric === "latencyP95Ms")?.pass, true);
    const ures = technicalGate(evaluate([]));
    assert.ok(ures.every((g) => g.pass === null));
  });

  /*
    A KUSZOB ZART: a pontosan 0,9-es bizonyossag MAR kuszob feletti. A
    kalibracio 2026-09-28-an ezt fogta meg: a `>=` -> `>` csere egyetlen
    allitast sem pirositott, mert egyik elem sem allt pontosan a hataron.
  */
  it("a pontosan 0,9-es bizonyosság már küszöb feletti", () => {
    const hatar = evaluate(
      [{ item: elem("h1", ["c_szivattyu"]), outcome: jo("c_szivattyu", 0.9) }],
      0.9,
    );
    assert.equal(hatar.coverageAtThreshold, 1);
    assert.equal(hatar.accuracyAtThreshold, 1);
  });
});
