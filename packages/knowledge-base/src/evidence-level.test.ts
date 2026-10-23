import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_REPLICATES,
  STUDY_TYPES,
  computeAgreement,
  deriveEvidenceLevel,
  designTier,
  levelRank,
  type EvidenceItem,
  type EvidenceLevel,
  type StudyType,
} from "./evidence-level.js";

const item = (
  sourceId: string,
  studyType: StudyType | null,
  controlled: boolean | null = true,
  sampleSize: number | null = 6,
): EvidenceItem => ({ sourceId, studyType, controlled, sampleSize });

const level = (supporting: EvidenceItem[], contradictingSources = 0) =>
  deriveEvidenceLevel({ supporting, contradictingSources }).level;

describe("rule 1: design tier per source", () => {
  const expected: Record<StudyType, EvidenceLevel> = {
    CONTROLLED_LAB: "SINGLE_EXPERIMENT",
    MESOCOSM: "SINGLE_EXPERIMENT",
    FIELD_EXPERIMENT: "SINGLE_EXPERIMENT",
    META_ANALYSIS: "SINGLE_EXPERIMENT",
    FIELD_OBSERVATIONAL: "OBSERVATIONAL",
    AQUARIUM_SURVEY: "OBSERVATIONAL",
    OWN_MEASUREMENT: "OBSERVATIONAL",
    AQUARIUM_CASE: "SINGLE_REPORT",
    MANUFACTURER: "SINGLE_REPORT",
    REVIEW: "SINGLE_REPORT",
  };
  for (const type of STUDY_TYPES)
    it(`${type}, controlled, ${MIN_REPLICATES}+ replicates -> ${expected[type]}`, () => {
      assert.equal(
        designTier(item("s", type, true, MIN_REPLICATES)),
        expected[type],
      );
    });

  it("an experiment without a control is an observation", () => {
    assert.equal(
      designTier(item("s", "CONTROLLED_LAB", false)),
      "OBSERVATIONAL",
    );
    assert.equal(
      designTier(item("s", "CONTROLLED_LAB", null)),
      "OBSERVATIONAL",
    );
  });

  it("an experiment on too few or unreported replicates is an observation", () => {
    assert.equal(
      designTier(item("s", "MESOCOSM", true, MIN_REPLICATES - 1)),
      "OBSERVATIONAL",
    );
    assert.equal(
      designTier(item("s", "MESOCOSM", true, null)),
      "OBSERVATIONAL",
    );
  });

  it("an unclassified source has no tier", () => {
    assert.equal(designTier(item("s", null)), null);
  });
});

describe("rules 2-4: the claim's level", () => {
  it("no supporting or only unclassified sources: no level", () => {
    assert.equal(level([]), null);
    assert.equal(level([item("a", null), item("b", null)]), null);
  });

  it("two independent controlled experiments agree: CONSISTENT_EXPERIMENTS", () => {
    assert.equal(
      level([item("a", "CONTROLLED_LAB"), item("b", "FIELD_EXPERIMENT")]),
      "CONSISTENT_EXPERIMENTS",
    );
  });

  it("two rows of ONE source are one experiment", () => {
    assert.equal(
      level([item("a", "CONTROLLED_LAB"), item("a", "CONTROLLED_LAB")]),
      "SINGLE_EXPERIMENT",
    );
  });

  it("a contradicting source caps the level at OBSERVATIONAL", () => {
    assert.equal(
      level([item("a", "CONTROLLED_LAB"), item("b", "CONTROLLED_LAB")], 1),
      "OBSERVATIONAL",
    );
    assert.equal(level([item("a", "AQUARIUM_CASE")], 1), "SINGLE_REPORT");
  });

  it("the reasons name the rules that fired, with the rules version", () => {
    const r = deriveEvidenceLevel({
      supporting: [item("a", "CONTROLLED_LAB"), item("b", "CONTROLLED_LAB")],
      contradictingSources: 1,
    });
    assert.match(
      r.reasons.join(" | "),
      /best design tier SINGLE_EXPERIMENT over 2 source\(s\)/,
    );
    assert.match(r.reasons.join(" | "), /capped at OBSERVATIONAL/);
    assert.match(r.rulesVersion, /^evidence-rules-v\d+/);
  });
});

/**
 * Condition 4 of the handoff: the classification must not be overconfident
 * and must not reward a design for its volume. These run over the whole grid
 * of one- and two-source inputs, not over hand-picked examples.
 */
describe("overconfidence and method bias, over the full grid", () => {
  const controls = [true, false, null] as const;
  const samples = [null, MIN_REPLICATES - 1, MIN_REPLICATES, 50] as const;
  const singles: EvidenceItem[] = [];
  for (const t of [...STUDY_TYPES, null])
    for (const c of controls)
      for (const n of samples) singles.push(item("x", t, c, n));
  const rank = (l: EvidenceLevel | null) => (l === null ? -1 : levelRank(l));

  it(`the grid is the size it claims (${singles.length} single sources)`, () => {
    assert.equal(
      singles.length,
      (STUDY_TYPES.length + 1) * controls.length * samples.length,
    );
  });

  it("weakening never raises the level", () => {
    let pairs = 0;
    for (const a of singles)
      for (const b of singles) {
        const base = [a, { ...b, sourceId: "y" }];
        for (const contra of [0, 1]) {
          const before = rank(level(base, contra));
          const weaker: EvidenceItem[][] = [
            [{ ...a, controlled: false }, base[1]!],
            [{ ...a, sampleSize: null }, base[1]!],
            [a],
          ];
          for (const w of weaker) {
            assert.ok(
              rank(level(w, contra)) <= before,
              JSON.stringify({ base, w, contra }),
            );
            pairs++;
          }
          assert.ok(
            rank(level(base, contra + 1)) <= before,
            JSON.stringify({ base, contra }),
          );
          pairs++;
        }
      }
    assert.ok(pairs > 10000, `only ${pairs} comparisons ran`);
  });

  it("no number of observational or anecdotal sources reaches an experimental level", () => {
    for (const type of STUDY_TYPES) {
      const tierOfOne = designTier(item("s", type, false, 50));
      for (let n = 1; n <= 20; n++) {
        const many = Array.from({ length: n }, (_, i) =>
          item(`s${i}`, type, false, 50),
        );
        assert.equal(level(many), tierOfOne, `${n} x ${type}`);
      }
    }
  });

  it("only CONSISTENT_EXPERIMENTS needs more than one source; a single source never reaches it", () => {
    for (const s of singles)
      assert.notEqual(level([s]), "CONSISTENT_EXPERIMENTS", JSON.stringify(s));
  });
});

describe("computeAgreement", () => {
  it("counts distinct sources per side, QUALIFIES on neither", () => {
    assert.deepEqual(
      computeAgreement(
        [
          { sourceId: "a", stance: "SUPPORTS" },
          { sourceId: "a", stance: "SUPPORTS" },
          { sourceId: "b", stance: "SUPPORTS" },
          { sourceId: "c", stance: "CONTRADICTS" },
          { sourceId: "d", stance: "QUALIFIES" },
        ],
        ["c", "e"],
      ),
      { supportingSources: 2, contradictingSources: 2 },
    );
  });
});
