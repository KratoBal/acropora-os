import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vocabularyV1 } from "@acropora/knowledge-base";

import { checkClaims } from "./claim-check.js";
import { claimAnswerOf } from "./claim-extractor.js";
import { extractSource, type ExtractionDeps } from "./extraction-run.js";
import { JATS, PASSAGE, aiClaim } from "./extraction-test-fixtures.js";
import { chunkSections, chunkText, jatsSections } from "./jats-text.js";

/**
 * THE OS SIDE OF THE CLAIM EXTRACTION (S3). WHAT TURNS IT RED: a passage or
 * an anchor not in the downloaded text stored; the model's locator trusted; a
 * value outside the approved vocabulary, or a species whose Latin name is not
 * in its anchor, stored as a field; a number away from its unit; a retracted
 * or already extracted source read again; an introduction's claim taken.
 */
const vocabulary = vocabularyV1();

describe("the JATS text, by section", () => {
  it("abstract and the body's top-level sections; no introduction, no back matter, no graphical abstract", () => {
    const sections = jatsSections(JATS);
    assert.deepEqual(
      sections.map((s) => s.locator),
      ["Abstract", "Methods", "Results"],
    );
    const all = sections.map((s) => s.text).join("\n");
    assert.doesNotMatch(all, /Earlier work|Thanks to|Ref 1|Graphical/);
    // the nested section stays in its parent; inline markup leaves no gap; entities decoded
    const methods = sections[1]!.text;
    assert.match(methods, /Colonies of Acropora millepora \(n = 12\)/);
    assert.match(methods, /26 °C/);
    assert.match(methods, /Treatments were 0\.5 and 2 µM phosphate\./);
    assert.match(sections[2]!.text, /\(± 3\.1 SE\)/);
    assert.match(sections[2]!.text, /0\.5 µM \| 1\.42 \|/);
  });

  it("chunks pack whole sections, and split a long one at line breaks", () => {
    const sections = jatsSections(JATS);
    assert.equal(chunkSections(sections).length, 1);
    assert.match(chunkText(chunkSections(sections)[0]!), /^Abstract\n/);
    const long = [
      { locator: "Results", text: Array(10).fill("x".repeat(40)).join("\n") },
    ];
    const parts = chunkSections(long, 100);
    assert.ok(parts.length > 1);
    assert.ok(parts.flat().every((p) => p.locator.startsWith("Results (")));
    assert.ok(parts.every((c) => chunkText(c).length <= 100 + 20));
  });
});

describe("the OS's own check of the AI's claims", () => {
  const sections = jatsSections(JATS);

  it("a well-anchored claim: every field, the question, and the locator decided here", () => {
    const { claims, refusedClaims } = checkClaims(
      [aiClaim()],
      sections,
      vocabulary,
    );
    assert.deepEqual(refusedClaims, []);
    const c = claims[0]!;
    assert.deepEqual(c.passage, { text: PASSAGE, locator: "Results" });
    assert.equal(c.species, "ACROPORA_MILLEPORA");
    assert.equal(c.environment, "LAB");
    assert.equal(c.effect, "CALCIFICATION");
    assert.equal(c.direction, "DECREASE");
    assert.equal(c.studyType, "CONTROLLED_LAB");
    assert.equal(c.measurementMethod, "AUTOANALYZER");
    assert.deepEqual(c.sampleSize, { value: 12, unit: "colonies" });
    assert.equal(c.uncertainty, "± 3.1 SE");
    // 2 µmol/l = 0.18994 mg/l PO4: code, not the model
    assert.equal(c.quantity?.normalizedMinMgL, 0.18994);
    assert.deepEqual(c.refused, []);
    const species = c.anchors.find((a) => a.field === "species" && !a.proposed);
    assert.equal(species?.locator, "Methods", "an anchor's own section");
    const question = c.anchors.find((a) => a.proposed);
    assert.deepEqual(
      [question?.field, question?.proposed, question?.normalizedValue],
      ["species", "Porites lutea", null],
    );
  });

  it("one changed letter in the passage drops the claim; in an anchor, that field", () => {
    const passage = checkClaims(
      [
        aiClaim({
          passage: {
            text: PASSAGE.replace("decreased", "decreases"),
            locator: "Results",
          },
        }),
      ],
      sections,
      vocabulary,
    );
    assert.deepEqual(
      [passage.claims.length, passage.refusedClaims],
      [0, ["PASSAGE_NOT_IN_TEXT"]],
    );
    const field = checkClaims(
      [
        aiClaim({
          fields: [
            {
              field: "direction",
              value: "DECREASE",
              anchor: "Calcification increased by 18 %",
            },
          ],
          questions: [],
        }),
      ],
      sections,
      vocabulary,
    );
    assert.deepEqual(field.claims[0]?.refused, [
      { field: "direction", refusal: "ANCHOR_NOT_IN_TEXT" },
    ]);
    assert.equal(field.claims[0]?.direction, null);
  });

  it("a vocabulary key whose Latin name is not in its anchor, or a key the vocabulary lacks: a question", () => {
    const { claims } = checkClaims(
      [
        aiClaim({
          fields: [
            {
              field: "species",
              value: "ACROPORA_TENUIS",
              anchor: "Colonies of Acropora millepora (n = 12)",
            },
            {
              field: "effect",
              value: "RESPIRATION",
              anchor: "Calcification decreased",
            },
          ],
          questions: [],
        }),
      ],
      sections,
      vocabulary,
    );
    const c = claims[0]!;
    assert.equal(c.species, null);
    assert.equal(c.effect, null);
    assert.deepEqual(
      c.anchors.map((a) => [a.field, a.proposed, a.normalizedValue]),
      [
        ["species", "ACROPORA_TENUIS", null],
        ["effect", "RESPIRATION", null],
      ],
    );
  });

  it("a number away from its unit, a micrometre, a missing basis: refused", () => {
    const q = (quantity: Record<string, unknown>) =>
      checkClaims(
        [
          aiClaim({
            fields: [{ field: "quantity", ...quantity }],
            questions: [],
          }),
        ],
        sections,
        vocabulary,
      ).claims[0]!.refused;
    assert.deepEqual(
      q({
        min: 18,
        max: 18,
        unit: "µmol/l",
        anchor: "decreased by 18 % at 2 µM phosphate",
      }),
      [{ field: "quantity", refusal: "NUMBER_NOT_AT_UNIT" }],
    );
    assert.deepEqual(
      q({
        min: 2,
        max: 2,
        unit: "mg/l",
        basis: "PO4",
        anchor: "at 2 µM phosphate",
      }),
      [{ field: "quantity", refusal: "UNIT_NOT_IN_ANCHOR" }],
    );
    assert.deepEqual(
      q({
        min: 2,
        max: 2,
        unit: "µmol/l",
        basis: null,
        anchor: "at 2 µM phosphate",
      }),
      [],
    );
  });

  it("a closed value's one-word anchor proves nothing; a sample size's unit is cleaned (barracuda, #1838)", () => {
    const { claims } = checkClaims(
      [
        aiClaim({
          fields: [
            {
              field: "effect",
              value: "CALCIFICATION",
              anchor: "Calcification",
            },
            {
              field: "sampleSize",
              value: 12,
              unit: "<b>colonies</b>",
              anchor: "(n = 12)",
            },
          ],
          questions: [],
        }),
      ],
      sections,
      vocabulary,
    );
    const c = claims[0]!;
    assert.deepEqual(c.refused, [
      { field: "effect", refusal: "ANCHOR_TOO_SHORT" },
    ]);
    assert.deepEqual(c.sampleSize, { value: 12, unit: "bcoloniesb" });
  });

  it("the AI answer's shape: a refusal, or a claim list; anything else unavailable", () => {
    assert.deepEqual(claimAnswerOf({ refusal: "NOT_JSON", extractedBy: "x" }), {
      kind: "REFUSED",
      refusal: "NOT_JSON",
    });
    assert.deepEqual(claimAnswerOf({ refusal: "<b>" }), {
      kind: "REFUSED",
      refusal: "UNKNOWN_REFUSAL",
    });
    assert.equal(claimAnswerOf({}).kind, "UNAVAILABLE");
    const a = claimAnswerOf({
      claims: [],
      refusedClaims: [{ refusal: "PASSAGE_NOT_IN_TEXT" }],
      extractedBy: "gpt-5.1 claim-extraction/v1",
    });
    assert.deepEqual(a, {
      kind: "ANSWER",
      claims: [],
      refusedClaims: ["PASSAGE_NOT_IN_TEXT"],
      extractedBy: "gpt-5.1 claim-extraction/v1",
    });
  });
});

describe("extracting one source", () => {
  function deps(
    over: Partial<ExtractionDeps> = {},
    source: Record<string, unknown> = {},
  ) {
    const calls: string[] = [];
    const value: ExtractionDeps = {
      store: {
        source: async (id: string) => ({
          id,
          pmcid: "PMC1",
          retracted: false,
          included: true,
          alreadyExtracted: false,
          retractionUnchecked: false,
          ...source,
        }),
        saveSource: async (input: {
          claims: unknown[];
          extractedBy: string;
          contentHash: string;
          runId?: string;
        }) => {
          calls.push(
            `save:${input.claims.length}:${input.extractedBy}:${input.contentHash.length}${input.runId ? `:${input.runId}` : ""}`,
          );
          return {
            claimsCreated: input.claims.length,
            anchorsCreated: 0,
            questions: 0,
          };
        },
      } as unknown as ExtractionDeps["store"],
      extractor: {
        extract: async (input) => {
          calls.push(
            `ai:${input.subject}:${input.vocabulary.taxa.includes("ACROPORA_MILLEPORA")}`,
          );
          return {
            kind: "ANSWER",
            claims: [aiClaim()],
            refusedClaims: [],
            extractedBy: "m claim-extraction/v1",
          };
        },
      },
      fetch: async (url) => {
        calls.push(`get:${url}`);
        return new Response(JATS, { status: 200 });
      },
      vocabulary,
      now: () => new Date("2026-10-23T15:00:00Z"),
      ...over,
    };
    return { value, calls };
  }

  it("downloads, asks the AI once per chunk, checks, and stores with apply", async () => {
    const d = deps();
    const outcome = await extractSource("src1", true, d.value);
    assert.equal(outcome.status, "EXTRACTED");
    assert.deepEqual(
      [
        outcome.claims,
        outcome.fields,
        outcome.questions,
        outcome.claimsCreated,
      ],
      [1, 9, 1, 1],
    );
    assert.deepEqual(d.calls, [
      "get:https://www.ebi.ac.uk/europepmc/webservices/rest/PMC1/fullTextXML",
      "ai:PHOSPHATE:true",
      "save:1:m claim-extraction/v1:64",
    ]);
  });

  it("a stored run's id reaches the store, so a stale-failed run cannot write", async () => {
    const d = deps({ runId: "run-9" });
    await extractSource("src1", true, d.value);
    assert.ok(d.calls.includes("save:1:m claim-extraction/v1:64:run-9"));
  });

  it("without apply: the same counts, nothing stored", async () => {
    const d = deps();
    const outcome = await extractSource("src1", false, d.value);
    assert.equal(outcome.status, "PREVIEWED");
    assert.ok(!d.calls.some((c) => c.startsWith("save:")));
  });

  it("skips, before any request: not included, retracted, already extracted, no PMCID, not found", async () => {
    for (const [source, reason] of [
      [{ included: false }, "NOT_INCLUDED"],
      [{ retracted: true }, "RETRACTED"],
      [{ alreadyExtracted: true }, "ALREADY_EXTRACTED"],
      [{ pmcid: null }, "NO_OPEN_FULL_TEXT"],
    ] as [Record<string, unknown>, string][]) {
      const d = deps({}, source);
      const outcome = await extractSource("src1", true, d.value);
      assert.deepEqual([outcome.status, outcome.reason], ["SKIPPED", reason]);
      assert.deepEqual(d.calls, []);
    }
    const missing = deps();
    (missing.value.store as unknown as { source: () => Promise<null> }).source =
      async () => null;
    assert.equal(
      (await extractSource("x", true, missing.value)).reason,
      "NOT_FOUND",
    );
  });

  it("an AI that only refuses: AI_REFUSED, nothing stored, so the text can be read again", async () => {
    const d = deps({
      extractor: {
        extract: async () => ({ kind: "REFUSED", refusal: "NOT_JSON" }),
      },
    });
    const outcome = await extractSource("src1", true, d.value);
    assert.deepEqual(
      [outcome.status, outcome.reason],
      ["SKIPPED", "AI_REFUSED"],
    );
    assert.ok(!d.calls.some((c) => c.startsWith("save:")));
  });

  it("an answer with no claim still stores (the text's hash), so the AI is not paid twice", async () => {
    const d = deps({
      extractor: {
        extract: async () => ({
          kind: "ANSWER",
          claims: [],
          refusedClaims: [],
          extractedBy: "m",
        }),
      },
    });
    const outcome = await extractSource("src1", true, d.value);
    assert.equal(outcome.status, "EXTRACTED");
    assert.ok(d.calls.includes("save:0:m:64"));
  });

  it("the outcome says when the retraction check never ran, and how many chunks were left out", async () => {
    const unchecked = deps({}, { retractionUnchecked: true });
    assert.equal(
      (await extractSource("src1", false, unchecked.value)).retractionUnchecked,
      true,
    );
    const big = `<article><body>${Array.from({ length: 8 }, (_, i) => `<sec><title>Results ${i}</title><p>${"x".repeat(29_000)}</p></sec>`).join("")}</body></article>`;
    const many = deps({
      fetch: async () => new Response(big, { status: 200 }),
    });
    const outcome = await extractSource("src1", false, many.value);
    assert.deepEqual([outcome.calls, outcome.chunksDropped], [6, 2]);
  });

  it("Europe PMC with no open text, and an AI that never answers: skipped with the reason", async () => {
    const closed = deps({
      fetch: async () => new Response("", { status: 404 }),
    });
    assert.equal(
      (await extractSource("src1", true, closed.value)).reason,
      "NO_OPEN_FULL_TEXT",
    );
    const silent = deps({
      extractor: {
        extract: async () => ({ kind: "UNAVAILABLE", reason: "timeout" }),
      },
    });
    const outcome = await extractSource("src1", true, silent.value);
    assert.deepEqual(
      [outcome.status, outcome.reason, outcome.unavailable],
      ["SKIPPED", "AI_UNAVAILABLE", { timeout: 1 }],
    );
    assert.ok(!silent.calls.some((c) => c.startsWith("save:")));
  });
});
