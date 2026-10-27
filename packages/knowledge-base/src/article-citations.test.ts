import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  citationReport,
  normaliseSentence,
  splitSentences,
  type CitationRow,
  type CitedClaim,
  type CitedConclusion,
} from "./article-citations.js";
import type { ClaimScope } from "./compare.js";
import {
  buildVocabulary,
  VOCABULARY_V1_ROWS,
  vocabularyV1,
} from "./vocabulary.js";

// the code's version 1 is approved; a draft is the same rows unapproved
const approved = vocabularyV1();
const draft = buildVocabulary(
  VOCABULARY_V1_ROWS.map((r) => ({ ...r, status: "DRAFT" as const })),
);

/** The compare.test.ts fixture claim: Acropora, field, 0.0285-0.095 mg/l PO4, calcification down. */
const SCOPE: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
const SUPPORTED =
  "Egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját.";
const INTRO = "Ebben a cikkben a forrásokat foglaljuk össze.";

const claims = new Map<string, CitedClaim>([
  ["c1", { status: "VERIFIED", scope: SCOPE }],
  ["c2", { status: "CANDIDATE", scope: SCOPE }],
]);
const conclusions = new Map<string, CitedConclusion>([
  ["k1", { status: "APPROVED", claimStatuses: ["VERIFIED"] }],
  ["k2", { status: "DRAFT", claimStatuses: ["VERIFIED"] }],
  ["k3", { status: "APPROVED", claimStatuses: ["VERIFIED", "DISPUTED"] }],
]);

let n = 0;
function row(
  sentence: string,
  target: Partial<CitationRow> & Pick<CitationRow, "kind">,
): CitationRow {
  n += 1;
  return {
    id: `r${n}`,
    sentence: normaliseSentence(sentence),
    claimId: null,
    conclusionId: null,
    answeredCodes: [],
    ...target,
  };
}

function report(text: string, citations: CitationRow[], vocabulary = approved) {
  return citationReport({ text, citations, claims, conclusions, vocabulary });
}

describe("splitSentences", () => {
  it("splits at a sentence end before a capital", () => {
    assert.deepEqual(splitSentences("Első mondat. Második mondat! Harmadik?"), [
      "Első mondat.",
      "Második mondat!",
      "Harmadik?",
    ]);
  });

  it("does not split after an abbreviation, an initial or inside a number", () => {
    assert.deepEqual(
      splitSentences(
        "Kb. 0,05 mg/l mellett az A. millepora nő, pl. a Acropora spp. Esetén is. Vége.",
      ),
      [
        "Kb. 0,05 mg/l mellett az A. millepora nő, pl. a Acropora spp. Esetén is.",
        "Vége.",
      ],
    );
  });

  it("splits a sentence ending in a number from the next one", () => {
    assert.deepEqual(splitSentences("Az érték 0,05. A másik 3."), [
      "Az érték 0,05.",
      "A másik 3.",
    ]);
  });

  it("takes blocks and list items one by one, without the list marker and the rule", () => {
    assert.deepEqual(
      splitSentences(
        "Cím\n\n- első tétel\n  - második\n3. harmadik\n\n----------\n\nZáró.",
      ),
      ["Cím", "első tétel", "második", "harmadik", "Záró."],
    );
  });

  it("normalises whitespace and the Unicode form", () => {
    assert.deepEqual(splitSentences("  Egy   mondat itt.  "), [
      "Egy mondat itt.",
    ]);
    assert.equal(normaliseSentence("á"), "á");
  });
});

describe("citationReport", () => {
  it("is clean when every sentence is cited and the check passes", () => {
    const r = report(`${INTRO} ${SUPPORTED}`, [
      row(INTRO, { kind: "NOT_TECHNICAL" }),
      row(SUPPORTED, { kind: "CLAIM", claimId: "c1" }),
    ]);
    assert.deepEqual(
      r.sentences.map((s) => s.status),
      ["OK", "OK"],
    );
    assert.equal(r.clean, true);
  });

  it("lists an uncited sentence and is not clean", () => {
    const r = report(`${INTRO} ${SUPPORTED}`, [
      row(SUPPORTED, { kind: "CLAIM", claimId: "c1" }),
    ]);
    assert.equal(r.sentences[0]?.status, "UNCITED");
    assert.equal(r.counts.uncited, 1);
    assert.equal(r.clean, false);
  });

  it("is not clean without a sentence", () => {
    assert.equal(report("", []).clean, false);
  });

  it("refuses a claim that is not VERIFIED, and a missing one", () => {
    const r = report(SUPPORTED, [
      row(SUPPORTED, { kind: "CLAIM", claimId: "c2" }),
      row(SUPPORTED, { kind: "CLAIM", claimId: "nope" }),
    ]);
    assert.equal(r.sentences[0]?.status, "INVALID");
    assert.deepEqual(
      r.sentences[0]?.citations.map((c) => c.problems),
      [["CLAIM_NOT_VERIFIED"], ["CLAIM_MISSING"]],
    );
    assert.equal(r.clean, false);
  });

  it("refuses a conclusion that is not approved, or whose claim is no longer VERIFIED", () => {
    const r = report(`${SUPPORTED} Második. Harmadik.`, [
      row(SUPPORTED, { kind: "CONCLUSION", conclusionId: "k1" }),
      row("Második.", { kind: "CONCLUSION", conclusionId: "k2" }),
      row("Harmadik.", { kind: "CONCLUSION", conclusionId: "k3" }),
    ]);
    assert.deepEqual(
      r.sentences.map((s) => s.citations[0]?.problems),
      [[], ["CONCLUSION_NOT_APPROVED"], ["CONCLUSION_CLAIM_NOT_VERIFIED"]],
    );
  });

  it("warns on the sentence check's findings, and an answer covers only the codes it named", () => {
    const wider = SUPPORTED.replace("0,05", "0,5");
    const open = report(wider, [row(wider, { kind: "CLAIM", claimId: "c1" })]);
    const codes = open.sentences[0]!.citations[0]!.unanswered;
    assert.ok(codes.includes("QUANTITY_OUT_OF_RANGE"), codes.join(", "));
    assert.equal(open.sentences[0]?.status, "WARNING");
    assert.equal(open.clean, false);

    const answered = report(wider, [
      row(wider, { kind: "CLAIM", claimId: "c1", answeredCodes: codes }),
    ]);
    assert.equal(answered.sentences[0]?.status, "OK");
    assert.equal(answered.clean, true);

    const partly = report(wider, [
      row(wider, {
        kind: "CLAIM",
        claimId: "c1",
        answeredCodes: codes.slice(1),
      }),
    ]);
    assert.deepEqual(partly.sentences[0]?.citations[0]?.unanswered, [codes[0]]);
  });

  it("orphans the citation of a rewritten sentence, and the new wording is uncited", () => {
    const rewritten = SUPPORTED.replace("csökkentette", "mérsékelte");
    const r = report(rewritten, [
      row(SUPPORTED, { kind: "CLAIM", claimId: "c1" }),
    ]);
    assert.equal(r.sentences[0]?.status, "UNCITED");
    assert.deepEqual(
      r.orphaned.map((o) => o.sentence),
      [normaliseSentence(SUPPORTED)],
    );
  });

  it("refuses a not-technical mark next to a citation, and warns when the sentence names claim parts", () => {
    const r = report(SUPPORTED, [
      row(SUPPORTED, { kind: "NOT_TECHNICAL" }),
      row(SUPPORTED, { kind: "CLAIM", claimId: "c1" }),
    ]);
    const mark = r.sentences[0]!.citations[0]!;
    assert.deepEqual(mark.problems, ["NOT_TECHNICAL_WITH_CITATION"]);
    assert.deepEqual(mark.unanswered, ["NOT_TECHNICAL_HAS_CLAIM_PARTS"]);
  });

  it("blocks on an unapproved vocabulary, whatever the citations", () => {
    const r = report(INTRO, [row(INTRO, { kind: "NOT_TECHNICAL" })], draft);
    assert.deepEqual(r.blockers, ["VOCABULARY_NOT_APPROVED"]);
    assert.equal(r.sentences[0]?.status, "OK");
    assert.equal(r.clean, false);
  });
});
