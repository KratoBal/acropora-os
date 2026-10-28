import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crossKindShadows, recogniseSentence } from "./sentence-parts.js";
import {
  VOCABULARY_V1_ROWS,
  VocabularyError,
  buildVocabulary,
  vocabularyV1,
  isAncestor,
  type VocabularyRow,
} from "./vocabulary.js";

const row = (over: Partial<VocabularyRow>): VocabularyRow => ({
  kind: "EFFECT",
  key: "X",
  forms: ["x-hatás"],
  status: "DRAFT",
  version: 1,
  ...over,
});

describe("the K4 vocabulary, version 1", () => {
  it("builds, and is APPROVED as the test-system base (acrobot's undisputed reading: Discord 1563178794708115548, 1563179163895070740, 1563181209628967012; the final approval is S4)", () => {
    const v = vocabularyV1();
    assert.equal(v.status, "APPROVED");
    assert.equal(v.version, 1);
    assert.ok(VOCABULARY_V1_ROWS.every((r) => r.status === "APPROVED"));
  });

  it("the taxon tree runs species -> genus -> group", () => {
    const v = vocabularyV1();
    assert.ok(isAncestor(v, "ACROPORA", "ACROPORA_MILLEPORA"));
    assert.ok(isAncestor(v, "SPS", "ACROPORA_MILLEPORA"));
    assert.ok(isAncestor(v, "CORAL", "ACROPORA"));
    assert.ok(!isAncestor(v, "ACROPORA_MILLEPORA", "ACROPORA"));
    assert.ok(!isAncestor(v, "MONTIPORA", "ACROPORA_MILLEPORA"));
    assert.ok(!isAncestor(v, "LPS", "ACROPORA"));
  });
});

describe("buildVocabulary refuses what a gate could misread", () => {
  it("one form under two keys of the same kind", () => {
    assert.throws(
      () =>
        buildVocabulary([
          row({ key: "A", forms: ["meszesedés"] }),
          row({ key: "B", forms: ["Meszesedés"] }),
        ]),
      VocabularyError,
    );
  });

  it("the same form in two different kinds is allowed", () => {
    buildVocabulary([
      row({ kind: "EFFECT", key: "A", forms: ["hatás"] }),
      row({
        kind: "DIRECTION_VERB",
        key: "B",
        forms: ["hatás"],
        rank: "NEUTRAL",
      }),
    ]);
  });

  it("a taxon with a missing parent", () => {
    assert.throws(
      () =>
        buildVocabulary([
          row({ kind: "TAXON", key: "A", rank: "GENUS", parentKey: "NOPE" }),
        ]),
      VocabularyError,
    );
  });

  it("a certainty phrase with an unknown level", () => {
    assert.throws(
      () =>
        buildVocabulary([
          row({ kind: "CERTAINTY", key: "A", rank: "VERY_SURE" }),
        ]),
      VocabularyError,
    );
  });

  it("a negation that is not an exact match", () => {
    assert.throws(
      () =>
        buildVocabulary([
          row({ kind: "NEGATION", key: "A", rank: "NEGATOR", forms: ["nem"] }),
        ]),
      VocabularyError,
    );
  });

  it("rows of two versions", () => {
    assert.throws(
      () =>
        buildVocabulary([
          row({ key: "A" }),
          row({ key: "B", forms: ["y"], version: 2 }),
        ]),
      VocabularyError,
    );
  });

  it("an unknown environment or scope-phrase key", () => {
    assert.throws(
      () => buildVocabulary([row({ kind: "ENVIRONMENT", key: "MOON" })]),
      VocabularyError,
    );
    assert.throws(
      () => buildVocabulary([row({ kind: "SCOPE_PHRASE", key: "WHATEVER" })]),
      VocabularyError,
    );
  });

  it("is APPROVED only when every live row is; RETIRED rows drop out", () => {
    assert.equal(
      buildVocabulary([row({ status: "APPROVED" })]).status,
      "APPROVED",
    );
    assert.equal(
      buildVocabulary([
        row({ status: "APPROVED" }),
        row({ key: "B", forms: ["y"] }),
      ]).status,
      "DRAFT",
    );
    const v = buildVocabulary([
      row({ status: "APPROVED" }),
      row({ key: "B", forms: ["y"], status: "RETIRED" }),
    ]);
    assert.equal(v.status, "APPROVED");
    assert.deepEqual(
      v.effects.map((e) => e.key),
      ["X"],
    );
  });
});

describe("recognition through the draft", () => {
  const v = vocabularyV1();
  it("stems match inflected forms, longest form wins", () => {
    const p = recogniseSentence(
      "Az Acropora milleporán a zátonyakváriumban a fehéredés-érzékenység nőtt.",
      v,
    );
    assert.deepEqual(p.taxa, ["ACROPORA_MILLEPORA"]);
    assert.deepEqual(p.environments, ["HOME_AQUARIUM"]);
    assert.deepEqual(p.effects, ["BLEACHING_SUSCEPTIBILITY"]);
    assert.deepEqual(p.verbDirections, ["INCREASE"]);
  });

  it("a word read by two kinds belongs to the longer form (korallzátony, sps-akvárium)", () => {
    const reef = recogniseSentence("A korallzátonyon az Acropora nőtt.", v);
    assert.deepEqual(reef.taxa, ["ACROPORA"]);
    assert.deepEqual(reef.environments, ["FIELD"]);
    const tank = recogniseSentence("Az sps-akváriumban a növekedés nőtt.", v);
    assert.deepEqual(tank.taxa, []);
    assert.deepEqual(tank.environments, ["HOME_AQUARIUM"]);
    // the shorter form standing as its own word is still read
    assert.deepEqual(recogniseSentence("A korall a zátonyon nőtt.", v).taxa, [
      "CORAL",
    ]);
  });

  it("version 1 has exactly these three cross-kind pairs: a new one must go in knowingly", () => {
    const pairs = crossKindShadows(v).map(
      (x) =>
        `${x.kind}/${x.key} "${x.form}" > ${x.shadows.kind}/${x.shadows.key} "${x.shadows.form}"`,
    );
    assert.deepEqual(pairs, [
      'TAXON/STONY_CORAL "zátonyépítő korall" > ENVIRONMENT/FIELD "zátony"',
      'ENVIRONMENT/FIELD "korallzátony" > TAXON/CORAL "korall"',
      'ENVIRONMENT/HOME_AQUARIUM "sps-akvárium" > TAXON/SPS "sps"',
    ]);
    // and each pair is what the recogniser does on the word
    assert.deepEqual(
      recogniseSentence("A zátonyépítő korallok nőttek.", v).environments,
      [],
    );
  });
  it("a multi-word form taken by a longer one of another kind shows up too, as the recogniser loses it (barracuda, #1941)", () => {
    const rows = [
      ...VOCABULARY_V1_ROWS,
      {
        ...VOCABULARY_V1_ROWS.find((r) => r.kind === "EFFECT")!,
        key: "SMALL_POLYP_GROWTH",
        forms: ["kis polipú kőkorall-növekedés"],
      },
    ];
    const vocabulary = buildVocabulary(rows);
    const added = crossKindShadows(vocabulary).filter(
      (x) => x.key === "SMALL_POLYP_GROWTH",
    );
    assert.deepEqual(
      added.map((x) => [x.shadows.key, x.shadows.form]),
      [
        ["STONY_CORAL", "kőkorall"],
        ["SPS", "kis polipú kőkorall"],
      ],
    );
    const parts = recogniseSentence(
      "A kis polipú kőkorall-növekedés nőtt.",
      vocabulary,
    );
    assert.deepEqual(parts.taxa, []);
    assert.deepEqual(parts.effects, ["SMALL_POLYP_GROWTH"]);
  });

  it("a new row that begins with another kind's form shows up as a pair", () => {
    const rows = [
      ...VOCABULARY_V1_ROWS,
      {
        ...VOCABULARY_V1_ROWS.find((r) => r.kind === "EFFECT")!,
        key: "CORAL_GROWTH",
        forms: ["korallnövekedés"],
      },
    ];
    const added = crossKindShadows(buildVocabulary(rows)).filter(
      (x) => x.key === "CORAL_GROWTH",
    );
    assert.deepEqual(
      added.map((x) => x.shadows.key),
      ["CORAL"],
    );
  });

  it("a stem-final a/e lengthens before a suffix (Acroporák, milleporán)", () => {
    assert.deepEqual(recogniseSentence("Az Acroporák kalcifikációja", v).taxa, [
      "ACROPORA",
    ]);
    assert.deepEqual(recogniseSentence("A Montiporáé", v).taxa, ["MONTIPORA"]);
    // but not as a bare word: "acroporá" alone is not a lengthened stem followed by a suffix
    assert.deepEqual(recogniseSentence("acroporá", v).taxa, []);
  });

  it("a number glued to a letter (PO4) is not a stray number; a thousands-looking one is", () => {
    assert.deepEqual(
      recogniseSentence("A PO4 szintje fontos.", v).unrecognisedNumbers,
      [],
    );
    assert.deepEqual(
      recogniseSentence("1,500 µg/l foszfát.", v).unrecognisedNumbers,
      ["1,500 µg/l"],
    );
  });

  it("an explicit basis after the unit wins over the sentence's basis word", () => {
    const [q] = recogniseSentence("0,1 mg/l P foszfát", v).quantities;
    assert.equal(q?.basis, "P");
  });

  it("both basis words in one sentence leave a mass unit without a basis", () => {
    const [q] = recogniseSentence(
      "0,1 mg/l foszfát, azaz foszfor",
      v,
    ).quantities;
    assert.equal(q?.basis, null);
    assert.equal(q?.minMgL, null);
  });
});
