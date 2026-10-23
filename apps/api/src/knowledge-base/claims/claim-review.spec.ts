import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vocabularyV1 } from "@acropora/knowledge-base";

import { SOURCE_FIELDS, checkClaims } from "../extraction/claim-check.js";
import { JATS, aiClaim } from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import {
  ReviewInputError,
  parseDiscardReason,
  parseReviewInput,
  planReview,
  type ClaimColumns,
  type FieldDecision,
  type ReviewAnchor,
  type ReviewInput,
} from "./claim-review.js";

/**
 * THE EDITOR'S FIELD-BY-FIELD REVIEW (S4, Figma 3:137). The anchors and the
 * columns are what the S3 check stores for the invented paper, so a
 * correction meets the very check the machine's value met.
 */
const vocabulary = vocabularyV1();

function fixture() {
  const { claims } = checkClaims([aiClaim()], jatsSections(JATS), vocabulary);
  const c = claims[0]!;
  const anchors: ReviewAnchor[] = c.anchors.map((a, i) => ({
    id: `a${i}`,
    field: a.field,
    owner: SOURCE_FIELDS.includes(a.field) ? "SOURCE" : "CLAIM",
    text: a.text,
    locator: a.locator,
    normalizedValue: a.normalizedValue,
    proposedValue: a.proposed ?? null,
    decision: "PENDING",
    correctedValue: null,
  }));
  const columns: ClaimColumns = {
    species: c.species ? [c.species] : [],
    environment: c.environment,
    effect: c.effect,
    direction: c.direction,
    quantity: c.quantity,
    sampleSize: c.sampleSize,
    uncertainty: c.uncertainty,
    conditions: c.conditions,
  };
  return { anchors, columns };
}

const NO_SOURCE = { studyType: null, measurementMethod: null };
const anchorOf = (anchors: ReviewAnchor[], field: string, question = false) =>
  anchors.find(
    (a) => a.field === field && (a.proposedValue !== null) === question,
  )!;

/** Every field accepted, the question rejected, then the overrides. */
function decide(
  anchors: ReviewAnchor[],
  over: Record<string, Omit<FieldDecision, "anchorId">> = {},
): ReviewInput {
  return {
    decisions: anchors.map((a) => ({
      anchorId: a.id,
      ...(over[a.id] ??
        (a.normalizedValue === null
          ? { decision: "REJECT" as const }
          : { decision: "ACCEPT" as const })),
    })),
    applicability: null,
  };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ReviewInputError);
    return `${error.code}: ${error.message}`;
  }
  assert.fail("no refusal");
};

describe("claim review: the plan", () => {
  it("every field accepted: the claim keeps its values, the source fields are set", () => {
    const { anchors, columns } = fixture();
    const plan = planReview(
      anchors,
      columns,
      NO_SOURCE,
      decide(anchors),
      vocabulary,
    );
    assert.deepEqual(plan.claim, columns);
    assert.deepEqual(plan.source, {
      studyType: "CONTROLLED_LAB",
      measurementMethod: "AUTOANALYZER",
    });
    const question = anchorOf(anchors, "species", true);
    assert.deepEqual(
      plan.anchors.find((a) => a.id === question.id),
      { id: question.id, decision: "REJECTED", correctedValue: null },
    );
    assert.equal(
      plan.anchors.filter((a) => a.decision === "ACCEPTED").length,
      anchors.length - 1,
    );
  });

  it("a field without a decision: nothing is saved", () => {
    const { anchors, columns } = fixture();
    const input = decide(anchors);
    input.decisions = input.decisions.filter(
      (d) => d.anchorId !== anchorOf(anchors, "uncertainty").id,
    );
    assert.equal(
      refusal(() => planReview(anchors, columns, NO_SOURCE, input, vocabulary)),
      "UNDECIDED_FIELD: uncertainty: no decision yet",
    );
  });

  it("an editor's question cannot be accepted as it is", () => {
    const { anchors, columns } = fixture();
    const q = anchorOf(anchors, "species", true);
    assert.match(
      refusal(() =>
        planReview(
          anchors,
          columns,
          NO_SOURCE,
          decide(anchors, { [q.id]: { decision: "ACCEPT" } }),
          vocabulary,
        ),
      ),
      /^QUESTION_NOT_ACCEPTABLE: species/,
    );
  });

  it("a question corrected to a key its anchor names becomes a field", () => {
    const { anchors, columns } = fixture();
    const q = anchorOf(anchors, "species", true);
    const plan = planReview(
      anchors,
      columns,
      NO_SOURCE,
      decide(anchors, { [q.id]: { decision: "CORRECT", value: "PORITES" } }),
      vocabulary,
    );
    // the list carries no order: the question anchor happens to come first
    assert.deepEqual([...plan.claim.species].sort(), [
      "ACROPORA_MILLEPORA",
      "PORITES",
    ]);
    assert.deepEqual(
      plan.anchors.find((a) => a.id === q.id),
      { id: q.id, decision: "CORRECTED", correctedValue: "PORITES" },
    );
  });

  it("a correction meets the machine's check: a species its anchor does not name is refused", () => {
    const { anchors, columns } = fixture();
    const s = anchorOf(anchors, "species");
    assert.equal(
      refusal(() =>
        planReview(
          anchors,
          columns,
          NO_SOURCE,
          decide(anchors, {
            [s.id]: { decision: "CORRECT", value: "ACROPORA_TENUIS" },
          }),
          vocabulary,
        ),
      ),
      "CORRECTION_REFUSED: species: NOT_A_KNOWN_ANCHORED_VALUE",
    );
  });

  it("a corrected quantity: a number not at its unit is refused, an anchored one is normalised by code", () => {
    const { anchors, columns } = fixture();
    const q = anchorOf(anchors, "quantity");
    const run = (value: unknown) =>
      planReview(
        anchors,
        columns,
        NO_SOURCE,
        decide(anchors, { [q.id]: { decision: "CORRECT", value } }),
        vocabulary,
      );
    assert.equal(
      refusal(() => run({ min: 3, max: 3, unit: "µmol/l", basis: null })),
      "CORRECTION_REFUSED: quantity: NUMBER_NOT_AT_UNIT",
    );
    const plan = run({ min: 2, max: null, unit: "µmol/l", basis: null });
    assert.equal(plan.claim.quantity?.min, 2);
    assert.equal(plan.claim.quantity?.max, null);
    // 2 µmol/l PO4 = 0.18994 mg/l (molar mass 94.97 g/mol)
    assert.ok(
      Math.abs((plan.claim.quantity?.normalizedMinMgL ?? 0) - 0.18994) < 1e-4,
    );
    assert.equal(
      plan.anchors.find((a) => a.id === q.id)?.correctedValue,
      "2- µmol/l",
    );
  });

  it("a rejected field is cleared, not left with the machine's value", () => {
    const { anchors, columns } = fixture();
    const n = anchorOf(anchors, "sampleSize");
    const u = anchorOf(anchors, "uncertainty");
    const plan = planReview(
      anchors,
      columns,
      NO_SOURCE,
      decide(anchors, {
        [n.id]: { decision: "REJECT" },
        [u.id]: { decision: "REJECT" },
      }),
      vocabulary,
    );
    assert.equal(columns.sampleSize?.value, 12);
    assert.equal(plan.claim.sampleSize, null);
    assert.equal(plan.claim.uncertainty, null);
    assert.equal(plan.claim.effect, "CALCIFICATION");
  });

  it("without its effect or direction the claim says nothing: discard it instead", () => {
    const { anchors, columns } = fixture();
    for (const field of ["effect", "direction"]) {
      const a = anchorOf(anchors, field);
      assert.match(
        refusal(() =>
          planReview(
            anchors,
            columns,
            NO_SOURCE,
            decide(anchors, { [a.id]: { decision: "REJECT" } }),
            vocabulary,
          ),
        ),
        /^CORE_FIELD_MISSING/,
      );
    }
  });

  it("an accepted field the claim no longer holds is a conflict, not a silent overwrite", () => {
    const { anchors, columns } = fixture();
    const moved = { ...columns, quantity: { ...columns.quantity!, min: 0.5 } };
    assert.match(
      refusal(() =>
        planReview(anchors, moved, NO_SOURCE, decide(anchors), vocabulary),
      ),
      /^STALE_FIELD: quantity/,
    );
  });

  it("two anchors on one field: accepting the one the claim does not hold is named as such, not as stale", () => {
    const { anchors, columns } = fixture();
    const d = anchorOf(anchors, "direction");
    const second: ReviewAnchor = {
      ...d,
      id: "dup",
      normalizedValue: "INCREASE",
    };
    const both = [...anchors, second];
    assert.match(
      refusal(() =>
        planReview(both, columns, NO_SOURCE, decide(both), vocabulary),
      ),
      /^DUPLICATE_FIELD_ANCHOR: direction/,
    );
    // rejecting the second one lets the claim through with the held value
    const plan = planReview(
      both,
      columns,
      NO_SOURCE,
      decide(both, { dup: { decision: "REJECT" } }),
      vocabulary,
    );
    assert.equal(plan.claim.direction, "DECREASE");
  });

  it("a source field decided earlier is not decided again, and still counts", () => {
    const { anchors, columns } = fixture();
    const st = anchorOf(anchors, "studyType");
    const earlier = anchors.map((a) =>
      a.id === st.id ? { ...a, decision: "ACCEPTED" as const } : a,
    );
    assert.match(
      refusal(() =>
        planReview(earlier, columns, NO_SOURCE, decide(earlier), vocabulary),
      ),
      /^ALREADY_DECIDED: studyType/,
    );
    const input = decide(earlier);
    input.decisions = input.decisions.filter((d) => d.anchorId !== st.id);
    const plan = planReview(earlier, columns, NO_SOURCE, input, vocabulary);
    assert.equal(plan.source.studyType, "CONTROLLED_LAB");
    assert.equal(
      plan.anchors.some((a) => a.id === st.id),
      false,
    );

    // a second study type for the same source: two kept values cannot both stand
    const second: ReviewAnchor = { ...st, id: "second", decision: "PENDING" };
    const both = [...earlier, second];
    const conflicting = decide(both, {
      second: { decision: "CORRECT", value: "FIELD_EXPERIMENT" },
    });
    conflicting.decisions = conflicting.decisions.filter(
      (d) => d.anchorId !== st.id,
    );
    assert.match(
      refusal(() =>
        planReview(both, columns, NO_SOURCE, conflicting, vocabulary),
      ),
      /^SOURCE_FIELD_CONFLICT: studyType/,
    );
  });

  it("a decision naming another claim's field is refused", () => {
    const { anchors, columns } = fixture();
    const input = decide(anchors);
    input.decisions.push({ anchorId: "elsewhere", decision: "ACCEPT" });
    assert.match(
      refusal(() => planReview(anchors, columns, NO_SOURCE, input, vocabulary)),
      /^UNKNOWN_ANCHOR/,
    );
  });
});

describe("claim review: the request", () => {
  it("reads decisions and an optional applicability with its reason", () => {
    assert.deepEqual(
      parseReviewInput({
        decisions: [
          { anchorId: "a", decision: "ACCEPT" },
          { anchorId: "b", decision: "CORRECT", value: "LAB" },
          { anchorId: "c", decision: "REJECT", value: "ignored" },
        ],
        applicability: {
          value: "LIMITED",
          reason: "  laborban, nem akváriumban ",
        },
      }),
      {
        decisions: [
          { anchorId: "a", decision: "ACCEPT" },
          { anchorId: "b", decision: "CORRECT", value: "LAB" },
          { anchorId: "c", decision: "REJECT" },
        ],
        applicability: {
          value: "LIMITED",
          reason: "laborban, nem akváriumban",
        },
      },
    );
  });

  it("refuses a malformed body, a duplicate, a correction without value, a reasonless applicability", () => {
    const code = (body: unknown) =>
      refusal(() => parseReviewInput(body)).split(":")[0];
    assert.equal(code({}), "BAD_BODY");
    assert.equal(
      code({ decisions: [{ anchorId: "a", decision: "MAYBE" }] }),
      "BAD_DECISION",
    );
    assert.equal(
      code({
        decisions: [
          { anchorId: "a", decision: "ACCEPT" },
          { anchorId: "a", decision: "REJECT" },
        ],
      }),
      "DUPLICATE_ANCHOR",
    );
    assert.equal(
      code({ decisions: [{ anchorId: "a", decision: "CORRECT" }] }),
      "NO_VALUE",
    );
    assert.equal(
      code({ decisions: [], applicability: { value: "LIMITED", reason: " " } }),
      "APPLICABILITY_REASON",
    );
    assert.equal(
      code({
        decisions: [],
        applicability: { value: "SOMEWHAT", reason: "x" },
      }),
      "BAD_APPLICABILITY",
    );
  });

  it("a discard needs a reason", () => {
    assert.equal(
      parseDiscardReason({ reason: " édesvízi faj " }),
      "édesvízi faj",
    );
    assert.match(
      refusal(() => parseDiscardReason({ reason: "" })),
      /^DISCARD_REASON/,
    );
    assert.match(
      refusal(() => parseDiscardReason({ reason: "x".repeat(501) })),
      /^DISCARD_REASON/,
    );
  });
});
