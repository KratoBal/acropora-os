import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { knownEntries, type KnownRow } from "./known-builder.js";
import {
  buildPairRequestDroppingBlocked,
  PairBlocked,
  type PairCandidate,
  type PairPayment,
} from "./pairing.js";
import { pyre } from "./pyre.js";
import {
  fold,
  knownSpans,
  knownTable,
  Redactor,
  REDACTION_VERSION,
  type KnownTable,
} from "./redact.js";
import {
  PAIRING_KEEP,
  PAIRING_KNOWN_ALLOW,
  REFERENCE_SHA256,
} from "./redact-data.js";

/*
  A PYTHON (marveen scripts/jev/redact.py, r12) KIMENETE, ES EZ A PORT ARRA KELL
  ADJA, BAJTRA. A vektorokat a scripts/redact-export.py irta ki; a teszt a
  Python-referencia LENYOMATAT is osszeveti, hogy adat es vektor egy forrasbol jojjon.
*/
type Outputs =
  | {
      text: string;
      counts: Record<string, number>;
      guard: string[];
      guardPairing: string[];
    }
  | { error: string };
interface Vectors {
  version: string;
  reference: string;
  commonWords: string[];
  cases: { suite: string; id: string; default: Outputs; pairing: Outputs }[];
  known: {
    entries: [string, string][];
    cases: {
      text: string;
      default: Outputs;
      pairing: Outputs;
      spans: [number, number, string][];
    }[];
  };
  knownBuilder: { rows: KnownRow[]; kept: KnownRow[] };
  pairing: {
    items: (PairPayment & { id: string; candidates: PairCandidate[] })[];
    unknown: PairVector[];
    known: PairVector[];
  };
}
type PairVector =
  | {
      body: string;
      placeholders: Record<string, number>;
      options: string[];
      kept: number[];
      dropped: [number, string][];
    }
  | { blocked: string; detail: string };

const vec = (name: string) =>
  new URL(`../redact-vectors/${name}`, import.meta.url);
const V = JSON.parse(readFileSync(vec("expected.json"), "utf8")) as Vectors;
const common = new Set(V.commonWords);

function outputs(r: Redactor, text: string, keep: readonly string[]): Outputs {
  try {
    const res = r.redact(text, { keepKinds: keep });
    return {
      text: res.text,
      counts: res.counts,
      guard: r.runtimeGuard(res),
      guardPairing: r.runtimeGuard(res, {
        allowKnownKinds: PAIRING_KNOWN_ALLOW,
      }),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A Python oldali szoveg a JSON-ban; a teszt a forrasbol olvassa, nem masolja. */
function suiteTexts(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [suite, file] of [
    ["hu-leak", "leak-suite.json"],
    ["pairing", "leak-suite-pairing.json"],
  ] as const) {
    const doc = JSON.parse(readFileSync(vec(file), "utf8")) as {
      cases: { id: string; text: string }[];
    };
    // a titkok torve allnak ("gh@@p_"), hogy a repo titok-kapuja ne lasson token-alakot
    for (const c of doc.cases)
      out.set(`${suite}:${c.id}`, c.text.replaceAll("@@", ""));
  }
  return out;
}

describe("a kitakaro portja: a Python-referencia kimenete", () => {
  it("ugyanaz a verzio es ugyanaz a referencia-fajl, amibol az adat jott", () => {
    assert.equal(REDACTION_VERSION, "r12");
    assert.equal(V.version, REDACTION_VERSION);
    assert.equal(V.reference, REFERENCE_SHA256);
  });

  it("mind a 257 kesz-eset alap- es parositas-modban, az orrel egyutt", () => {
    const r = new Redactor({ commonWords: common, known: null });
    const texts = suiteTexts();
    assert.equal(V.cases.length, texts.size);
    assert.ok(V.cases.length >= 257, `${V.cases.length} eset`);
    const diffs: string[] = [];
    for (const c of V.cases) {
      const text = texts.get(`${c.suite}:${c.id}`);
      assert.ok(text !== undefined, c.id);
      for (const [mode, keep] of [
        ["default", []],
        ["pairing", PAIRING_KEEP],
      ] as const) {
        const got = outputs(r, text, keep);
        try {
          assert.deepEqual(got, c[mode]);
        } catch {
          diffs.push(
            `${c.suite}:${c.id} ${mode}\n  py ${JSON.stringify(c[mode])}\n  ts ${JSON.stringify(got)}`,
          );
        }
      }
    }
    assert.equal(diffs.length, 0, diffs.slice(0, 5).join("\n"));
  });

  it("a ket kesz-letben nincs szivargas, es a megorzendo uzleti adat megmarad", () => {
    const r = new Redactor({ commonWords: common, known: null });
    const leaks: string[] = [];
    let kept = 0;
    let keepTotal = 0;
    for (const [file, keep] of [
      ["leak-suite.json", []],
      ["leak-suite-pairing.json", PAIRING_KEEP],
    ] as const) {
      const doc = JSON.parse(
        readFileSync(vec(file), "utf8").replaceAll("@@", ""),
      ) as {
        cases: { id: string; text: string; leak?: string[]; keep?: string[] }[];
      };
      for (const c of doc.cases) {
        const out = fold(r.redact(c.text, { keepKinds: keep }).text);
        for (const s of c.leak ?? [])
          if (out.includes(fold(s))) leaks.push(`${c.id}: ${s}`);
        for (const s of c.keep ?? []) {
          keepTotal++;
          if (out.includes(fold(s))) kept++;
        }
      }
    }
    assert.deepEqual(leaks, []);
    // a Python ugyanezt meri: 431/440 es 36/36 (a 9 elveszett megorzendo nem szivargas)
    assert.equal(`${kept}/${keepTotal}`, "467/476");
  });

  it("a known-entity reteg: ugyanazok a talalatok, ugyanaz a kimenet es ugyanaz az or", () => {
    const known: KnownTable = knownTable(V.known.entries);
    const r = new Redactor({ commonWords: common, known });
    for (const c of V.known.cases) {
      assert.deepEqual(knownSpans(c.text, known), c.spans, c.text);
      assert.deepEqual(outputs(r, c.text, []), c.default, c.text);
      assert.deepEqual(outputs(r, c.text, PAIRING_KEEP), c.pairing, c.text);
    }
  });
});

describe("a known-entity lista epitese: ugyanaz, mint a build_known.py", () => {
  it("a sorok, az aliasok, a szuro es az EXTRA, ugyanabban a sorrendben", () => {
    assert.deepEqual(
      knownEntries(V.knownBuilder.rows, common),
      V.knownBuilder.kept,
    );
  });
});

describe("a parositas kerese: ugyanaz a torzs, mint a merese", () => {
  for (const [mode, known] of [
    ["unknown", null],
    ["known", knownTable(V.known.entries)],
  ] as const)
    it(`${mode === "known" ? "known-entity listaval" : "lista nelkul"}`, () => {
      const r = new Redactor({ commonWords: common, known });
      V.pairing.items.forEach((item, i) => {
        const want = V.pairing[mode][i]!;
        let got: PairVector;
        try {
          const q = buildPairRequestDroppingBlocked(r, item, item.candidates);
          got = {
            body: JSON.stringify({
              state: q.state,
              model: q.model,
              questions: {
                [q.questionKey]: {
                  type: "choice",
                  criteria: q.criteria,
                  instructions: q.instructions,
                },
              },
            }),
            placeholders: q.placeholders,
            options: Object.keys(q.criteria),
            kept: [...q.candidateIndexes],
            dropped: q.dropped.map((d) => [d.index, d.outcome]),
          };
        } catch (e) {
          if (!(e instanceof PairBlocked)) throw e;
          got = { blocked: e.outcome, detail: e.detail };
        }
        if ("body" in want) {
          // a Python ", " es ": " elvalasztoval ir; a kulcs-sorrend es a tartalom szamit
          assert.ok("body" in got, `${item.id}: ${JSON.stringify(got)}`);
          assert.equal(
            got.body,
            JSON.stringify(JSON.parse(want.body)),
            item.id,
          );
          assert.deepEqual(got.placeholders, want.placeholders, item.id);
          assert.deepEqual(got.options, want.options, item.id);
          assert.deepEqual(got.kept, want.kept, item.id);
          assert.deepEqual(got.dropped, want.dropped, item.id);
        } else assert.deepEqual(got, want, item.id);
      });
    });
});

describe("r12: a csupasz ceg-alias a teljes neven belul (acrobot 25567)", () => {
  const known = () =>
    knownTable(
      knownEntries([["ORG", "HANNA Instruments Service Kft."]], common),
    );
  const hanna = {
    number: "26/000878",
    date: "2026-05-02",
    gross: "146000",
    currency: "HUF",
    supplier: "HANNA Instruments Service Kft.",
  };
  const masik = {
    number: "2026/01039632",
    date: "2026-05-01",
    gross: "145854",
    currency: "HUF",
    supplier: "Euroleasing Zrt.",
  };

  it("a HANNA szamla jelolt marad, es lehet o maga a helyes", () => {
    const r = new Redactor({ commonWords: common, known: known() });
    const fizetes = {
      date: "2026-05-10",
      amount: "146000",
      currency: "HUF",
      original: "",
      partner: "HANNA Instruments Service Kft.",
      narrative: "26/000878",
      type: "ÁTUTALÁS",
    };
    const q = buildPairRequestDroppingBlocked(r, fizetes, [hanna, masik]);
    assert.deepEqual(q.dropped, []);
    assert.deepEqual(q.candidateIndexes, [0, 1]);
    assert.match(q.state.c0!, /HANNA Instruments Service Kft\./);
    assert.match(q.state.query!, /HANNA Instruments Service Kft\./);
  });

  it("egy jelolt, amit az or tenyleg megallit, kiesik; ha egy sem marad, nincs keres", () => {
    const r = new Redactor({
      commonWords: common,
      known: knownTable([["ORG", "FANK"]]),
    });
    const fizetes = {
      date: "2026-05-10",
      amount: "1999",
      currency: "HUF",
      original: "",
      partner: "Akvárium Szerviz Kft.",
      narrative: "SZ-2026/0815",
      type: "ÁTUTALÁS",
    };
    const fank = { ...masik, number: "FANK-2026" };
    const q = buildPairRequestDroppingBlocked(r, fizetes, [fank, masik]);
    assert.deepEqual(q.candidateIndexes, [1]);
    assert.deepEqual(
      q.dropped.map((d) => [d.index, d.outcome]),
      [[0, "blocked_runtime_guard"]],
    );
    assert.ok(!JSON.stringify(q.state).includes("FANK"));
    assert.throws(
      () => buildPairRequestDroppingBlocked(r, fizetes, [fank]),
      (e: unknown) =>
        e instanceof PairBlocked && e.detail === "no candidate left",
    );
  });
});

describe("pyre: a Python-jelek forditasa", () => {
  it("a \\w es a [^\\W\\d_] ekezetes betut is lat, a \\d csak szamjegyet", () => {
    assert.deepEqual("Ő1_é".match(pyre("\\w+", { global: true })), ["Ő1_é"]);
    assert.deepEqual("Ő1_é".match(pyre("[^\\W\\d_]+", { global: true })), [
      "Ő",
      "é",
    ]);
    assert.deepEqual("Ő1_é".match(pyre("[^\\W_]+", { global: true })), [
      "Ő1",
      "é",
    ]);
  });

  it("a \\b Unicode-szohatar, nem ASCII", () => {
    assert.equal(pyre("\\bárvíz\\b").test("az árvíz jön"), true);
    assert.equal(pyre("\\brvíz").test("árvíz"), false);
  });

  it("a $ a zaro sortores elott is illeszkedik, mint a Pythonban", () => {
    assert.equal(pyre("Kft\\.$").test("Fekete Kft.\n"), true);
    assert.equal(pyre("Kft\\.$").test("Fekete Kft.\nx"), false);
  });

  it("a \\s a Python halmaza: az U+FEFF nem szokoz, az U+001F az", () => {
    assert.equal(pyre("^\\s$").test("﻿"), false);
    assert.equal(pyre("^\\s$").test("\u001f"), true);
  });

  it("amit nem ismer, arra forditaskor dob", () => {
    assert.throws(() => pyre("(?P=v)"));
    assert.throws(() => pyre("a(?i)b"));
    assert.throws(() => pyre("\\Z"));
  });
});
