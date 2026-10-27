import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANSWER_FALLBACK_SENTENCE,
  ANSWER_FIXED_SENTENCES,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  buildAnswerPackage,
  gateAnswer,
  layersNamed,
  namedClaimParts,
  type PackageCandidate,
  type PackageClaim,
} from "./answer-gate.js";
import type { ClaimScope } from "./compare.js";
import {
  buildVocabulary,
  VOCABULARY_V1_ROWS,
  vocabularyV1,
} from "./vocabulary.js";

/**
 * The answer gate (plan v4, 7 "A válaszoló AI hivatkozás-kapuja"): the five
 * T11 cases, the T13 error classes through the gate (each with its correct
 * pair, the base sentence), the layer phrases (T5), the fallback, and the
 * package.
 *
 * The fixture claim is compare.test's: a controlled field experiment on
 * Acropora, phosphate 0.3-1 µmol/l (0.0285-0.095 mg/l PO4) decreasing
 * calcification.
 */
const vocabulary = vocabularyV1();

const ACROPORA_FIELD: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
const AQUARIUM_REPORT: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["HOME_AQUARIUM"],
  homeReefApplicability: "DIRECT",
  quantity: { minMgL: 0.03, maxMgL: 0.1 },
  effect: "COLORATION",
  direction: "INCREASE",
  evidenceLevel: "SINGLE_REPORT",
};

const SCI: PackageClaim = {
  id: "c1sci",
  layer: "SCIENTIFIC",
  scope: ACROPORA_FIELD,
  citation: "Koop és mtsai, 2001",
};
const HOBBY: PackageClaim = {
  id: "c2hob",
  layer: "HOBBY_EXPERIENCE",
  scope: AQUARIUM_REPORT,
  citation: "Holmes-Farley, 2002",
};
const PACKAGE = [SCI, HOBBY];

// The sentence the SCI claim supports, written as the model is asked to.
const BASE =
  "Kutatás szerint egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját [[claim:c1sci]].";
const BASE_OUT =
  "Kutatás szerint egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját (Koop és mtsai, 2001).";
const HOBBY_SENTENCE =
  "Akvarisztikai tapasztalat szerint, egy akvarisztikai beszámoló szerint az otthoni akváriumban 0,05 mg/l foszfát növelte az Acropora színezetét [[claim:c2hob]].";
const INTRO = ANSWER_FIXED_SENTENCES[0]!;

function gate(text: string, pack: readonly PackageClaim[] = PACKAGE) {
  return gateAnswer({ text, package: pack, vocabulary });
}
function codesOf(text: string, pack?: readonly PackageClaim[]): string[] {
  return gate(text, pack).sentences.flatMap((s) =>
    s.reasons.map((r) => r.code),
  );
}
function cited(text: string) {
  const r = gate(text);
  assert.deepEqual(
    r.sentences.map((s) => [s.status, s.reasons.map((x) => x.code)]),
    [["CITED", []]],
    text,
  );
  return r;
}
function dropped(text: string, code: string, pack?: readonly PackageClaim[]) {
  const r = gate(text, pack);
  assert.equal(r.counts.dropped, 1, text);
  const got = codesOf(text, pack);
  assert.ok(
    got.includes(code),
    `expected ${code} for "${text}", got [${got.join(", ")}]`,
  );
  return r;
}

describe("the base sentences", () => {
  it("the scientific one passes, and its marker becomes the readable reference", () => {
    assert.equal(cited(BASE).text, BASE_OUT);
  });
  it("the hobby one passes with its own layer phrase", () => {
    cited(HOBBY_SENTENCE);
  });
});

describe("T11: the gate's calibration, the plan's five cases", () => {
  it("(a) a number without a marker is dropped", () => {
    dropped(BASE.replace(" [[claim:c1sci]]", ""), "UNMARKED");
  });
  it("(b) a technical sentence without a number and without a marker is dropped", () => {
    dropped("A foszfáthiány fokozza a fehéredés-érzékenységet.", "UNMARKED");
  });
  it("(c) a marker with the wrong value is dropped", () => {
    dropped(BASE.replace("0,05 mg/l", "0,5 mg/l"), "QUANTITY_OUT_OF_RANGE");
  });
  it("(d) an existing claim outside the package, with a matching value, is dropped", () => {
    const outside = BASE.replace("c1sci", "c9out");
    dropped(outside, "MARKER_OUTSIDE_PACKAGE");
    // the same claim, handed over, would pass: the package is the only difference
    const pack = [...PACKAGE, { ...SCI, id: "c9out" }];
    assert.deepEqual(codesOf(outside, pack), []);
  });
  it("(e) a correct marker and a fixed sentence both pass", () => {
    const r = gate(`${INTRO} ${BASE}`);
    assert.deepEqual(r.counts, { cited: 1, fixed: 1, dropped: 0 });
    assert.equal(r.text, `${INTRO} ${BASE_OUT}`);
    assert.equal(r.answered, true);
  });
});

describe("T13 through the gate: each error class dropped, its correct pair (the base) cited", () => {
  const cases: [string, string, string][] = [
    ["a species swap", BASE.replace("Acropora", "Montipora"), "TAXON_SWAP"],
    [
      "an unmarked transfer downwards (genus data -> species)",
      BASE.replace("az Acropora", "az Acropora millepora"),
      "TAXON_NARROWED_UNMARKED",
    ],
    [
      "a direction reversed by a negation",
      BASE.replace("csökkentette", "nem csökkentette"),
      "REVERSED_BY_NEGATION",
    ],
    [
      "an unmarked environment transfer (field -> home aquarium)",
      BASE.replace("a zátonyon", "az akváriumban"),
      "ENVIRONMENT_TRANSFER_UNMARKED",
    ],
    [
      "a value outside the evidence range",
      BASE.replace("0,05 mg/l", "0,2 mg/l"),
      "QUANTITY_OUT_OF_RANGE",
    ],
    [
      "a verb stronger than the evidence level",
      BASE.replace("egy kontrollált kísérletben", "kimutatták, hogy"),
      "STRENGTH_TOO_STRONG",
    ],
    [
      "a related but other effect (skeletal density for calcification)",
      BASE.replace("kalcifikációját", "vázsűrűségét"),
      "EFFECT_MISMATCH",
    ],
  ];
  for (const [name, sentence, code] of cases)
    it(name, () => {
      assert.notEqual(sentence, BASE, "the mutation did not apply");
      dropped(sentence, code);
      cited(BASE);
    });
});

describe("T5: the layer phrase", () => {
  it("a cited claim's layer phrase is required", () => {
    dropped(BASE.replace("Kutatás szerint egy", "Egy"), "LAYER_PHRASE_MISSING");
  });
  it("another layer's phrase is refused", () => {
    dropped(
      BASE.replace("Kutatás szerint", "Kutatás szerint és a gyártó szerint"),
      "LAYER_PHRASE_OF_OTHER_LAYER",
    );
  });
  it("recognises whole words only, case-insensitively", () => {
    assert.deepEqual(layersNamed("KUTATÁSOK SZERINT ez így van."), [
      "SCIENTIFIC",
    ]);
    assert.deepEqual(layersNamed("A kutatás nem szerint való."), []);
    assert.deepEqual(layersNamed("Következtetésünk szerint igen."), [
      "OWN_CONCLUSION",
    ]);
  });
});

describe("a sentence citing two claims", () => {
  it("must be supported by each: the scientific sentence citing the hobby claim too is dropped", () => {
    const both = BASE.replace(
      "[[claim:c1sci]]",
      "[[claim:c1sci]] [[claim:c2hob]]",
    );
    const r = dropped(both, "LAYER_PHRASE_MISSING");
    const about = r.sentences[0]!.reasons.filter(
      (x) => x.claimId === "c2hob",
    ).map((x) => x.code);
    assert.ok(about.includes("EFFECT_MISMATCH"), about.join(", "));
  });
  it("one marker twice is one claim, one reference", () => {
    const twice = BASE.replace(
      "[[claim:c1sci]]",
      "[[claim:c1sci]][[claim:c1sci]]",
    );
    const r = cited(twice);
    assert.deepEqual(r.sentences[0]!.claimIds, ["c1sci"]);
    assert.equal(r.text, BASE_OUT);
  });
});

describe("markers", () => {
  it("a marker after the period is moved before it, and the next sentence stays separate", () => {
    const after = BASE.replace(" [[claim:c1sci]].", ". [[claim:c1sci]]");
    const r = gate(`${after} ${INTRO}`);
    assert.deepEqual(r.counts, { cited: 1, fixed: 1, dropped: 0 });
    assert.equal(r.text, `${BASE_OUT} ${INTRO}`);
  });
  it("the marker is not part of the checked sentence: a number-shaped id is not read as a number", () => {
    const year = { ...SCI, id: "2024" };
    const r = gateAnswer({
      text: BASE.replace("c1sci", "2024"),
      package: [year],
      vocabulary,
    });
    assert.deepEqual(r.sentences[0]!.reasons, []);
  });
  it("a malformed marker drops the sentence", () => {
    dropped(
      BASE.replace("[[claim:c1sci]]", "[[claim:c1sci]] [[forrás:x]]"),
      "MALFORMED_MARKER",
    );
    dropped(BASE.replace("[[claim:c1sci]]", "[[claim:]]"), "MALFORMED_MARKER");
  });
  it("a fixed sentence with a marker is judged as a claim sentence, not waved through", () => {
    dropped(INTRO.replace(".", " [[claim:c1sci]]."), "LAYER_PHRASE_MISSING");
  });
});

describe("the fallback", () => {
  it("a run of dropped sentences becomes ONE fallback sentence, in place", () => {
    const bad = "A foszfáthiány fokozza a fehéredés-érzékenységet.";
    const r = gate(`${BASE} ${bad} ${bad} ${HOBBY_SENTENCE} ${bad}`);
    assert.deepEqual(r.counts, { cited: 2, fixed: 0, dropped: 3 });
    assert.equal(
      r.text,
      [
        BASE_OUT,
        ANSWER_FALLBACK_SENTENCE,
        HOBBY_SENTENCE.replace(" [[claim:c2hob]]", " (Holmes-Farley, 2002)"),
        ANSWER_FALLBACK_SENTENCE,
      ].join(" "),
    );
  });
  it("without a cited sentence the answer is the no-knowledge sentence alone", () => {
    const r = gate(
      `${INTRO} A foszfáthiány fokozza a fehéredés-érzékenységet.`,
    );
    assert.equal(r.answered, false);
    assert.equal(r.text, ANSWER_NO_KNOWLEDGE_SENTENCE);
    assert.equal(gate("").text, ANSWER_NO_KNOWLEDGE_SENTENCE);
  });
  it("an unapproved vocabulary drops every claim sentence", () => {
    const draft = buildVocabulary(
      VOCABULARY_V1_ROWS.map((r) => ({ ...r, status: "DRAFT" as const })),
    );
    const r = gateAnswer({ text: BASE, package: PACKAGE, vocabulary: draft });
    assert.equal(r.answered, false);
    assert.ok(
      r.sentences[0]!.reasons.some((x) => x.code === "VOCABULARY_NOT_APPROVED"),
    );
  });
});

describe("the fixed sentences", () => {
  it("name no claim part and no layer, and pass the gate as FIXED", () => {
    for (const s of ANSWER_FIXED_SENTENCES) {
      assert.deepEqual(namedClaimParts(s, vocabulary), [], s);
      assert.deepEqual(layersNamed(s), [], s);
      assert.equal(gate(s).sentences[0]!.status, "FIXED", s);
    }
  });
  it("match letter for letter: one changed word is a technical sentence", () => {
    dropped(INTRO.replace("csak", "főleg"), "UNMARKED");
  });
});

describe("the package", () => {
  const candidate = (
    over: Partial<PackageCandidate> = {},
  ): PackageCandidate => ({
    id: "k1",
    layer: "SCIENTIFIC",
    subject: "PHOSPHATE",
    status: "VERIFIED",
    scope: ACROPORA_FIELD,
    verbatimSupport: 1,
    uses: ["AI_INTERNAL"],
    citation: " Koop és mtsai, 2001 ",
    ...over,
  });
  const build = (candidates: PackageCandidate[], limit = 10) =>
    buildAnswerPackage({
      candidates,
      subject: "PHOSPHATE",
      audience: "AI_INTERNAL",
      limit,
    });

  it("lets in a VERIFIED claim on the topic with verbatim support, released for the audience", () => {
    const p = build([candidate()]);
    assert.deepEqual(p.claims, [
      {
        id: "k1",
        layer: "SCIENTIFIC",
        scope: ACROPORA_FIELD,
        citation: "Koop és mtsai, 2001",
      },
    ]);
    assert.deepEqual(p.excluded, []);
  });
  it("names every reason a claim stays out", () => {
    const cases: [Partial<PackageCandidate>, string][] = [
      [{ subject: "NITRATE" }, "OTHER_SUBJECT"],
      [{ status: "CANDIDATE" }, "NOT_VERIFIED"],
      [{ status: "DISPUTED" }, "NOT_VERIFIED"],
      [{ verbatimSupport: 0 }, "NO_VERBATIM_EVIDENCE"],
      [{ uses: [] }, "USE_NOT_RELEASED"],
      [
        { scope: { ...ACROPORA_FIELD, evidenceLevel: null } },
        "NO_EVIDENCE_LEVEL",
      ],
      [{ citation: null }, "NO_CITATION"],
      [{ citation: "  " }, "NO_CITATION"],
    ];
    for (const [over, reason] of cases) {
      const p = build([candidate(over)]);
      assert.deepEqual(p.claims, [], reason);
      assert.deepEqual(p.excluded, [{ id: "k1", reasons: [reason] }], reason);
    }
  });
  it("an internal release is not a public one", () => {
    const p = buildAnswerPackage({
      candidates: [candidate()],
      subject: "PHOSPHATE",
      audience: "AI_PUBLIC",
      limit: 10,
    });
    assert.deepEqual(p.excluded, [{ id: "k1", reasons: ["USE_NOT_RELEASED"] }]);
  });
  it("strongest evidence first, then by id, up to the limit", () => {
    const weak = { ...ACROPORA_FIELD, evidenceLevel: "SINGLE_REPORT" as const };
    const p = build(
      [
        candidate({ id: "b", scope: weak }),
        candidate({ id: "c" }),
        candidate({ id: "a", scope: weak }),
      ],
      2,
    );
    assert.deepEqual(
      p.claims.map((c) => c.id),
      ["c", "a"],
    );
    assert.equal(p.truncated, 1);
  });
});
