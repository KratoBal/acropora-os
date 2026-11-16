import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeTeachingSource,
  findTeachingReferences,
  parseTeachingSourceInput,
  TEACHING_SOURCE_LIMITS,
  type TeachingNumber,
  type TeachingPart,
} from "./teaching-source.js";

/*
  THE TEACHING SOURCE (T5.2). The cases are the ones the Akil trial measured
  (spec v2, point 7): one name with two doses told apart by context, the cycle
  length written twice with two values, the target salinity standing in many
  parts, the dose in three spellings. What turns these red: a contradicting
  number silently accepted (or one of the two picked); a number used outside
  its part; a reference to a number, a form or a spoken form that does not
  exist; a half-written reference that would print as it is; a where-used list
  that misses a checklist item or a speaker note.
*/

const num = (
  over: Partial<TeachingNumber> & { id: string },
): TeachingNumber => ({
  name: over.id,
  context: null,
  approx: false,
  quantity: { value: { kind: "exact", value: 1 }, unit: "ml" },
  pairs: [],
  partKey: null,
  display: "1 ml",
  short: "1 ml",
  spoken: null,
  inflections: [],
  state: "OK",
  note: null,
  ...over,
});

const part = (over: Partial<TeachingPart> & { key: string }): TeachingPart => ({
  title: over.key,
  text: "",
  subparts: [],
  checklist: [],
  speakerNote: null,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  baseVersion: null,
  subtitle: "Az első hat hét",
  author: "Akil, Modern Reef blog, 2026. 10. 15.",
  editor: "Acropora szerkesztőség",
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer:
    "A termékleírások a gyártó állításait adják vissza, ezeket az Acropora nem mérte.",
  parts: [
    part({
      key: "inditas",
      text: "Cél: {szám: celso, rövid}.",
      subparts: [{ key: "lepes-1", title: "1. lépés", text: "" }],
    }),
  ],
  numbers: [
    num({
      id: "celso",
      name: "Célsótartalom",
      quantity: { value: { kind: "exact", value: 1.026 }, unit: "SG" },
      pairs: [{ value: { kind: "exact", value: 35 }, unit: "PSU" }],
      display: "1,026 SG (kb. 35 PSU)",
      short: "1,026 SG",
      spoken: "egy egész huszonhat ezred, kb. harmincöt PSU",
    }),
  ],
  ...over,
});

describe("parseTeachingSourceInput", () => {
  it("takes a full source; an empty optional text is stored as null", () => {
    const parsed = parseTeachingSourceInput(input({ editor: "  " }));
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
    assert.equal(parsed.value.editor, null);
    assert.equal(parsed.value.numbers[0]?.pairs[0]?.unit, "PSU");
    assert.equal(parsed.value.parts[0]?.subparts[0]?.title, "1. lépés");
  });

  it("refuses an unknown field at every level, and a non-object", () => {
    const n = num({ id: "a" });
    for (const bad of [
      input({ extra: 1 }),
      input({ parts: [{ ...part({ key: "a" }), extra: 1 }] }),
      input({
        parts: [
          part({
            key: "a",
            subparts: [{ key: "b", title: "B", text: "", x: 1 }] as never,
          }),
        ],
      }),
      input({ numbers: [{ ...n, extra: 1 }] }),
      input({
        numbers: [
          {
            ...n,
            quantity: { value: { kind: "exact", value: 1, x: 1 }, unit: "" },
          },
        ],
      }),
      "forrás",
      null,
    ])
      assert.equal(
        parseTeachingSourceInput(bad).ok,
        false,
        JSON.stringify(bad),
      );
  });

  it("refuses a doubled key or id; part and sub-part keys share one space", () => {
    for (const bad of [
      input({ parts: [part({ key: "a" }), part({ key: "a" })] }),
      input({
        parts: [
          part({ key: "a", subparts: [{ key: "b", title: "B", text: "" }] }),
          part({ key: "b" }),
        ],
      }),
      input({ numbers: [num({ id: "x" }), num({ id: "x" })] }),
    ])
      assert.equal(
        parseTeachingSourceInput(bad).ok,
        false,
        JSON.stringify(bad),
      );
  });

  it("refuses a bad key, a bad range, a non-finite value, an unknown state", () => {
    for (const bad of [
      input({ parts: [part({ key: "Első Rész" })] }),
      input({
        numbers: [
          num({
            id: "x",
            quantity: { value: { kind: "range", min: 4, max: 2 }, unit: "hét" },
          }),
        ],
      }),
      input({
        numbers: [
          num({
            id: "x",
            quantity: { value: { kind: "range", min: 2, max: 2 }, unit: "hét" },
          }),
        ],
      }),
      input({
        numbers: [
          num({
            id: "x",
            quantity: { value: { kind: "exact", value: Infinity }, unit: "" },
          }),
        ],
      }),
      input({
        numbers: [
          num({
            id: "x",
            quantity: { value: { kind: "about", value: 1 }, unit: "" } as never,
          }),
        ],
      }),
      input({ numbers: [num({ id: "x", state: "MAYBE" as never })] }),
      input({ numbers: [num({ id: "x", display: " " })] }),
      input({
        parts: [
          part({
            key: "a",
            speakerNote: { text: "x", state: "DRAFT" as never },
          }),
        ],
      }),
    ])
      assert.equal(
        parseTeachingSourceInput(bad).ok,
        false,
        JSON.stringify(bad),
      );
  });

  it("refuses an inflection named like a base form, doubled, or with a brace", () => {
    const inf = (name: string) => ({ name, written: "4 hétig", spoken: null });
    for (const infl of [
      [inf("rövid")],
      [inf("Kimondott")],
      [inf("hétig"), inf("hétig")],
      [inf("a,b")],
    ])
      assert.equal(
        parseTeachingSourceInput(
          input({ numbers: [num({ id: "x", inflections: infl })] }),
        ).ok,
        false,
        JSON.stringify(infl),
      );
  });

  it("a PUBLIC source names what allows it", () => {
    assert.equal(
      parseTeachingSourceInput(input({ audience: "PUBLIC" })).ok,
      false,
    );
    assert.ok(
      parseTeachingSourceInput(
        input({
          audience: "PUBLIC",
          publicBasis: "A szerző írásos engedélye, 2026-11-10",
        }),
      ).ok,
    );
    assert.equal(
      parseTeachingSourceInput(input({ audience: "EVERYONE" })).ok,
      false,
    );
  });

  it("baseVersion is null or a positive whole number", () => {
    for (const bad of [0, -1, 1.5, "1", undefined])
      assert.equal(
        parseTeachingSourceInput(input({ baseVersion: bad })).ok,
        false,
        String(bad),
      );
    assert.ok(parseTeachingSourceInput(input({ baseVersion: 3 })).ok);
  });

  it("holds the limits", () => {
    const L = TEACHING_SOURCE_LIMITS;
    for (const bad of [
      input({
        parts: Array.from({ length: L.parts + 1 }, (_, i) =>
          part({ key: `p${i}` }),
        ),
      }),
      input({ parts: [part({ key: "a", text: "x".repeat(L.text + 1) })] }),
      input({
        parts: [
          part({
            key: "a",
            checklist: Array.from({ length: L.checklist + 1 }, () => "x"),
          }),
        ],
      }),
      input({
        numbers: Array.from({ length: L.numbers + 1 }, (_, i) =>
          num({ id: `n${i}` }),
        ),
      }),
      input({ author: "x".repeat(L.shortText + 1) }),
    ])
      assert.equal(parseTeachingSourceInput(bad).ok, false);
  });
});

describe("findTeachingReferences", () => {
  it("reads the form names as the spec writes them, with or without accents", () => {
    const { references, malformed } = findTeachingReferences(
      "A {szám: celso, rövid} és {szam: celso, rovid}, {Szám: celso}, {szám: celso, kimondott}, {szám:ciklus,hétig}.",
    );
    assert.deepEqual(malformed, []);
    assert.deepEqual(
      references.map((r) => [r.numberId, r.form]),
      [
        ["celso", "short"],
        ["celso", "short"],
        ["celso", "display"],
        ["celso", "spoken"],
        ["ciklus", "hétig"],
      ],
    );
  });

  it("catches what starts like a reference but is not one", () => {
    const { references, malformed } = findTeachingReferences(
      "{szám: a, rövid, más} és {szám a} és {szám: b",
    );
    assert.equal(references.length, 0);
    assert.equal(malformed.length, 3);
    // a word that only begins the same is no reference
    assert.equal(findTeachingReferences("{számla: 12}").malformed.length, 0);
  });
});

describe("analyzeTeachingSource", () => {
  it("one name with two doses told apart by context is no open question (Nitri-Bac)", () => {
    const a = analyzeTeachingSource({
      parts: [part({ key: "a", text: "{szám: nb-indulo} majd {szám: nb-uj}" })],
      numbers: [
        num({
          id: "nb-indulo",
          name: "Nitri-Bac adag",
          context: "induláskor",
          quantity: { value: { kind: "exact", value: 50 }, unit: "ml/100 l" },
        }),
        num({
          id: "nb-uj",
          name: "Nitri-Bac adag",
          context: "újraindításnál és minden új halnál",
          quantity: { value: { kind: "exact", value: 5 }, unit: "ml/100 l" },
        }),
      ],
    });
    assert.deepEqual(a.problems, []);
    assert.deepEqual(a.openQuestions, []);
  });

  it("two values for one quantity: both stay, both open, none picked (cycle length)", () => {
    const a = analyzeTeachingSource({
      parts: [
        part({
          key: "negy",
          text: "{szám: ciklus-4} és {szám: ciklus-idovonal}",
        }),
      ],
      numbers: [
        num({
          id: "ciklus-4",
          name: "A ciklus hossza",
          quantity: { value: { kind: "range", min: 2, max: 4 }, unit: "hét" },
        }),
        num({
          id: "ciklus-idovonal",
          name: "a ciklus  hossza",
          quantity: { value: { kind: "range", min: 2, max: 6 }, unit: "hét" },
        }),
      ],
    });
    assert.deepEqual(a.problems, []);
    assert.deepEqual(
      a.openQuestions.map((q) => [q.numberId, q.reasons, q.conflictsWith]),
      [
        ["ciklus-4", ["CONFLICT"], ["ciklus-idovonal"]],
        ["ciklus-idovonal", ["CONFLICT"], ["ciklus-4"]],
      ],
    );
  });

  it("the same value twice is no conflict, approx against exact is; a marked one is open on its own", () => {
    const a = analyzeTeachingSource({
      parts: [],
      numbers: [
        num({ id: "a", name: "Hőfok" }),
        num({ id: "b", name: "Hőfok" }),
        num({ id: "c", name: "Só" }),
        num({ id: "d", name: "Só", approx: true }),
        num({
          id: "e",
          name: "Kalcium",
          state: "OPEN_QUESTION",
          note: "A gyártó két értéket ír.",
        }),
      ],
    });
    assert.deepEqual(
      a.openQuestions.map((q) => [q.numberId, q.reasons, q.note]),
      [
        ["c", ["CONFLICT"], null],
        ["d", ["CONFLICT"], null],
        ["e", ["MARKED"], "A gyártó két értéket ír."],
      ],
    );
  });

  it("generates where a number stands: text, sub-part, checklist, speaker note", () => {
    const a = analyzeTeachingSource({
      parts: [
        part({
          key: "elso",
          text: "{szám: celso}",
          checklist: ["semmi", "Sótartalom: {szám: celso, rövid}"],
          speakerNote: { text: "{szám: celso, kimondott}", state: "SOURCE" },
        }),
        part({
          key: "masodik",
          subparts: [
            { key: "ok-1", title: "1. ok", text: "{szám: celso, rövid}" },
          ],
        }),
      ],
      numbers: [num({ id: "celso", spoken: "harmincöt" }), num({ id: "ures" })],
    });
    assert.deepEqual(a.problems, []);
    assert.deepEqual(a.usages[0]?.locations, [
      { partKey: "elso", subpartKey: null, field: "text", index: null },
      { partKey: "elso", subpartKey: null, field: "checklist", index: 1 },
      { partKey: "elso", subpartKey: null, field: "speakerNote", index: null },
      { partKey: "masodik", subpartKey: "ok-1", field: "text", index: null },
    ]);
    assert.deepEqual(a.unused, ["ures"]);
  });

  it("names every broken reference: unknown number, form, spoken form, scope, part, malformed", () => {
    const a = analyzeTeachingSource({
      parts: [
        part({
          key: "a",
          text: "{szám: nincs} {szám: helyi, hétig} {szám: helyi, kimondott} {szám: x",
        }),
        part({ key: "b", checklist: ["{szám: helyi}"] }),
      ],
      numbers: [
        num({ id: "helyi", partKey: "a" }),
        num({ id: "arva", partKey: "nincs-ilyen-resz" }),
      ],
    });
    assert.deepEqual(
      a.problems.map((p) => [p.code, p.location?.partKey ?? null]).sort(),
      [
        ["MALFORMED_REFERENCE", "a"],
        ["NO_SPOKEN_FORM", "a"],
        ["OUT_OF_SCOPE", "b"],
        ["UNKNOWN_FORM", "a"],
        ["UNKNOWN_NUMBER", "a"],
        ["UNKNOWN_PART", null],
      ],
    );
  });

  it("an inflection given on the number is a known form", () => {
    const a = analyzeTeachingSource({
      parts: [part({ key: "a", text: "kb. {szám: het, hétig}" })],
      numbers: [
        num({
          id: "het",
          inflections: [
            { name: "hétig", written: "4 hétig", spoken: "négy hétig" },
          ],
        }),
      ],
    });
    assert.deepEqual(a.problems, []);
  });
});

/*
  THE NUMBER TYPED INTO THE TEXT (barracuda on #2577): a warning, never a
  refusal. What turns this red: a typed quantity not warned about; a
  reference's own digits or an ordinal ("1. lépés") warned about.
*/
describe("typed numbers outside a reference", () => {
  it("warns about a typed quantity, not about a reference or an ordinal", () => {
    const a = analyzeTeachingSource({
      parts: [
        part({
          key: "a",
          text: "Az 1. lépésben {szám: n1} kell, a só 35 ppt, vagy 1,026 SG.",
          checklist: ["a 2. okban nincs szám"],
        }),
      ],
      numbers: [num({ id: "n1" })],
    });
    assert.deepEqual(a.problems, []);
    assert.deepEqual(
      a.typedNumbers.map((t) => [
        t.location.field,
        /35 ppt/.test(t.excerpt) || /1,026/.test(t.excerpt),
      ]),
      [
        ["text", true],
        ["text", true],
      ],
    );
  });
});

describe("the document size", () => {
  it("refuses parts and a table past the limit, by name", () => {
    const big = input({
      parts: Array.from({ length: 6 }, (_, i) =>
        part({ key: `p${i}`, text: "x".repeat(TEACHING_SOURCE_LIMITS.text) }),
      ),
    });
    const parsed = parseTeachingSourceInput(big);
    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.message,
      /at most 90000 bytes together/,
    );
  });

  it("counts bytes, not characters: an accented source under the character count is still refused (barracuda on #2578)", () => {
    // 3 x 15 000 "ő" = 45 000 characters, 90 000 bytes of text alone
    const accented = input({
      parts: Array.from({ length: 3 }, (_, i) =>
        part({ key: `p${i}`, text: "ő".repeat(15_000) }),
      ),
    });
    assert.equal(parseTeachingSourceInput(accented).ok, false);
    // the same shape in plain letters is half the bytes, and passes
    const plain = input({
      parts: Array.from({ length: 3 }, (_, i) =>
        part({ key: `p${i}`, text: "o".repeat(15_000) }),
      ),
    });
    assert.ok(parseTeachingSourceInput(plain).ok);
  });
});
