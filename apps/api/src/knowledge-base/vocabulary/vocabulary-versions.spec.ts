import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VOCABULARY_V1_ROWS,
  type VocabularyRow,
} from "@acropora/knowledge-base";

import {
  VocabularyInputError,
  approvedVocabulary,
  checkedRows,
  diffRows,
  draftCopy,
  draftFingerprint,
  editorsWorkingCopy,
  keyOf,
  labelOf,
  parseEntryEdit,
  parseNewEntry,
  versionsOf,
  workingRows,
  type StoredRow,
} from "./vocabulary-versions.js";

/**
 * THE VOCABULARY'S VERSIONS (S5, K4). WHAT TURNS IT RED: a draft read as the
 * approved vocabulary; an approved version taken from a half-approved one; an
 * edit that lands on the approved rows; a new key that clashes, a taxon
 * without its parent, a form under two keys let through.
 */
const v1 = VOCABULARY_V1_ROWS;
const draftOf = (version: number, extra: VocabularyRow[] = []) => [
  ...draftCopy(v1, version),
  ...extra,
];
const species = (key: string, form: string, parentKey = "POCILLOPORA") =>
  ({
    kind: "TAXON",
    key,
    forms: [form],
    parentKey,
    rank: "SPECIES",
    status: "DRAFT",
    version: 2,
  }) as VocabularyRow;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof VocabularyInputError) return e.code;
    throw e;
  }
  return "NO_ERROR";
};

describe("the approved version and the draft", () => {
  it("no database row: the code's version 1 is approved, no draft", () => {
    const v = versionsOf([]);
    assert.equal(v.approved.version, 1);
    assert.equal(v.approved.origin, "CODE");
    assert.equal(v.draft, null);
    assert.equal(workingRows(v).length, v1.length);
  });

  it("a draft of version 2: the approved is still the code's, the editor works on the draft", () => {
    const v = versionsOf(
      draftOf(2, [species("POCILLOPORA_VERRUCOSA", "pocillopora verrucosa")]),
    );
    assert.equal(v.approved.version, 1);
    assert.equal(v.draft?.version, 2);
    assert.ok(workingRows(v).some((r) => r.key === "POCILLOPORA_VERRUCOSA"));
    // the gate's vocabulary does not hold the draft key
    assert.equal(
      approvedVocabulary(v).taxa.some((t) => t.key === "POCILLOPORA_VERRUCOSA"),
      false,
    );
  });

  it("an approved version 2 in the database is the approved one; version 3 in draft beside it", () => {
    const approved: StoredRow[] = draftCopy(v1, 2).map((r) => ({
      ...r,
      status: "APPROVED",
      approvedAt: new Date("2026-10-23T20:00:00Z"),
      approvedById: "u1",
    }));
    const v = versionsOf([...approved, ...draftCopy(v1, 3)]);
    assert.equal(v.approved.version, 2);
    assert.equal(v.approved.origin, "DATABASE");
    assert.equal(v.approved.approvedById, "u1");
    assert.equal(v.draft?.version, 3);
    // a half-approved version is not approved
    const half = versionsOf([
      ...approved.slice(1),
      { ...approved[0]!, status: "DRAFT" },
    ]);
    assert.equal(half.approved.origin, "CODE");
    assert.equal(half.draft?.version, 2);
  });

  it("the editor's working copy holds the draft key; the approved vocabulary refuses to be a draft", () => {
    const rows = draftOf(2, [
      species("POCILLOPORA_VERRUCOSA", "pocillopora verrucosa"),
    ]);
    const copy = editorsWorkingCopy(rows);
    assert.equal(copy.status, "APPROVED");
    assert.ok(copy.taxa.some((t) => t.key === "POCILLOPORA_VERRUCOSA"));
  });
});

describe("what the draft changes", () => {
  it("added, changed and removed rows, by kind and key", () => {
    const draft = draftOf(2, [
      species("POCILLOPORA_VERRUCOSA", "pocillopora verrucosa"),
    ]).map((r) =>
      r.key === "ACROPORA_MURICATA"
        ? { ...r, forms: [...r.forms, "a. muricata"] }
        : r,
    );
    const changes = diffRows(
      v1,
      draft.filter((r) => r.key !== "EUPHYLLIA"),
    );
    assert.deepEqual(
      changes.map((c) => [c.change, c.key, c.fields]),
      [
        ["CHANGED", "ACROPORA_MURICATA", ["forms"]],
        ["ADDED", "POCILLOPORA_VERRUCOSA", []],
        ["REMOVED", "EUPHYLLIA", []],
      ],
    );
    // a copy changes nothing: the status and the version are no change
    assert.deepEqual(diffRows(v1, draftCopy(v1, 2)), []);
  });
});

describe("the draft's fingerprint (barracuda 35845)", () => {
  it("the same rows in another order, or another status, give the same; a changed form, a new row give another", () => {
    const rows = draftCopy(v1, 2);
    const fp = draftFingerprint(rows);
    assert.match(fp, /^[0-9a-f]{64}$/);
    assert.equal(draftFingerprint([...rows].reverse()), fp);
    assert.equal(
      draftFingerprint(
        rows.map((r) => ({ ...r, status: "APPROVED" as const })),
      ),
      fp,
    );
    assert.notEqual(
      draftFingerprint(
        rows.map((r) =>
          r.key === "GROWTH" ? { ...r, forms: [...r.forms, "gyarapodás"] } : r,
        ),
      ),
      fp,
    );
    assert.notEqual(
      draftFingerprint([
        ...rows,
        species("PORITES_LUTEA", "porites lutea", "PORITES"),
      ]),
      fp,
    );
  });
});

describe("a new entry", () => {
  it("a species: its key from its name, its rank and its parent", () => {
    const e = parseNewEntry(
      {
        kind: "TAXON",
        forms: ["Pocillopora verrucosa"],
        rank: "SPECIES",
        parentKey: "POCILLOPORA",
      },
      v1,
    );
    assert.deepEqual(e, {
      kind: "TAXON",
      key: "POCILLOPORA_VERRUCOSA",
      forms: ["Pocillopora verrucosa"],
      parentKey: "POCILLOPORA",
      rank: "SPECIES",
      note: null,
    });
  });

  it("an effect: the key may be the machine's word, the forms are Hungarian", () => {
    const e = parseNewEntry(
      {
        kind: "EFFECT",
        key: "MICROBIOMECOMPOSITION",
        forms: ["mikrobiom-összetétel", "mikrobiom összetétele"],
      },
      v1,
    );
    assert.equal(e.key, "MICROBIOMECOMPOSITION");
    assert.equal(labelOf({ ...e }), "Mikrobiom-összetétel");
    assert.equal(keyOf("belső tápanyag-tartalék"), "BELSO_TAPANYAG_TARTALEK");
  });

  it("refused: a closed kind, a taken key, a species without parent, an unknown parent, no forms", () => {
    assert.equal(
      code(() => parseNewEntry({ kind: "ENVIRONMENT", forms: ["kád"] }, v1)),
      "BAD_KIND",
    );
    assert.equal(
      code(() =>
        parseNewEntry(
          {
            kind: "TAXON",
            forms: ["acropora"],
            rank: "GENUS",
            parentKey: "SPS",
          },
          v1,
        ),
      ),
      "KEY_TAKEN",
    );
    assert.equal(
      code(() =>
        parseNewEntry({ kind: "TAXON", forms: ["x y"], rank: "SPECIES" }, v1),
      ),
      "NO_PARENT",
    );
    assert.equal(
      code(() =>
        parseNewEntry(
          { kind: "TAXON", forms: ["x y"], rank: "SPECIES", parentKey: "NOPE" },
          v1,
        ),
      ),
      "UNKNOWN_PARENT",
    );
    assert.equal(
      code(() => parseNewEntry({ kind: "EFFECT", forms: [] }, v1)),
      "BAD_FORMS",
    );
    assert.equal(
      code(() =>
        parseNewEntry({ kind: "EFFECT", key: "bad key", forms: ["a"] }, v1),
      ),
      "BAD_KEY",
    );
  });

  it("a form already under another key is refused before anything is written", () => {
    assert.equal(
      code(() =>
        checkedRows(
          draftOf(2, [
            species("ACROPORA_FORMOSA", "acropora formosa", "ACROPORA"),
          ]),
        ),
      ),
      "VOCABULARY_INVALID",
    );
    assert.equal(
      code(() =>
        checkedRows(
          draftOf(2, [
            species("POCILLOPORA_VERRUCOSA", "pocillopora verrucosa"),
          ]),
        ),
      ),
      "NO_ERROR",
    );
  });

  it("an edit: forms, a taxon's parent; not a parent on an effect, not an empty edit", () => {
    const muricata = v1.find((r) => r.key === "ACROPORA_MURICATA")!;
    assert.deepEqual(
      parseEntryEdit(
        { forms: ["acropora muricata", "a. muricata"] },
        muricata,
        v1,
      ),
      { forms: ["acropora muricata", "a. muricata"] },
    );
    const growth = v1.find((r) => r.key === "GROWTH")!;
    assert.equal(
      code(() => parseEntryEdit({ parentKey: "SPS" }, growth, v1)),
      "NOT_A_TAXON",
    );
    assert.equal(
      code(() => parseEntryEdit({}, growth, v1)),
      "NOTHING_TO_CHANGE",
    );
  });
});
