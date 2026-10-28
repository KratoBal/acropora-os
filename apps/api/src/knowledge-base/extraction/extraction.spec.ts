import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vocabularyV1 } from "@acropora/knowledge-base";

import {
  checkClaims,
  citesAnotherWork,
  keepOwnFindings,
  type CheckedClaim,
} from "./claim-check.js";
import { claimAnswerOf } from "./claim-extractor.js";
import { extractSource, type ExtractionDeps } from "./extraction-run.js";
import {
  JATS,
  PASSAGE,
  PDF_PAGES,
  aiClaim,
  pdfOf,
} from "./extraction-test-fixtures.js";
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

  it("a numbered citation keeps its mark, so the own-findings rule sees it (barracuda 35831)", () => {
    const xml = `<article><body><sec><title>Discussion</title>
<p>Enrichment decreased growth<sup><xref ref-type="bibr" rid="b12">12</xref></sup>. It fell further<xref ref-type="bibr" rid="b3">3–5</xref>.</p>
<p>As <xref ref-type="bibr" rid="b7">Neil et al., 2025</xref> showed. See <xref ref-type="fig" rid="f1">Fig. 1</xref> and <italic>Acropora</italic>.</p>
</sec></body></article>`;
    const text = jatsSections(xml)[0]!.text;
    assert.match(text, /decreased growth \[12\]\. It fell further \[3–5\]\./);
    // an author-year citation and a figure reference are left as written
    assert.match(
      text,
      /As Neil et al\., 2025 showed\. See Fig\. 1 and Acropora\./,
    );
    // the "[12]" shape is what CITED_RESULT reads
    const cited = text.split("\n").find((l) => l.includes("growth [12]"))!;
    assert.doesNotMatch(cited, /et al/);
    assert.equal(citesAnotherWork(cited), true);
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

  it("only a phosphate value is a quantity, and a '<' number is an upper bound alone (acrobot 35808, barracuda 35814)", () => {
    const text = [
      PASSAGE,
      "Bleaching was aggravated when nitrate exceeded 9 µmol/l, and mitigated below 9 µM ammonium.",
      "Under heat stress, colonies kept at nitrate < 9 µmol L−1 bleached less.",
      "Inflowing water held 0.58 ± 0.20 µM phosphate.",
      "Growth was highest at < 0.1 mg/L PO4.",
      "Colonies kept at phosphate < 2 µmol L−1 grew more; when phosphate exceeded 1 µM they bleached.",
      "Tanks not exceeding 3 µM phosphate kept their colour.",
    ].join("\n");
    const checked = (quantity: Record<string, unknown>) =>
      checkClaims(
        [
          aiClaim({
            fields: [{ field: "quantity", ...quantity }],
            questions: [],
          }),
        ],
        [{ locator: "Results", text }],
        vocabulary,
      ).claims[0]!;
    const quantityOf = (quantity: Record<string, unknown>) => {
      const claim = checked(quantity);
      assert.deepEqual(claim.refused, []);
      return claim.quantity;
    };
    const unconverted = { normalizedMinMgL: null, normalizedMaxMgL: null };
    // the case on stage: a nitrate of 9 µmol/l in a phosphate claim is no
    // quantity of it at all (a later gate would read it as PO4: barracuda 35814 a)
    for (const anchor of [
      "colonies kept at nitrate < 9 µmol L−1",
      "when nitrate exceeded 9 µmol/l",
      // phosphate named next to ammonium: not decided by a rule
      "and mitigated below 9 µM ammonium",
    ]) {
      const claim = checked({ min: 9, max: 9, unit: "µmol/l", anchor });
      assert.deepEqual(
        claim.refused,
        [{ field: "quantity", refusal: "QUANTITY_NOT_PHOSPHATE" }],
        anchor,
      );
      assert.equal(claim.quantity, null);
    }
    // a phosphate value converts as before; a plain value keeps both ends
    assert.deepEqual(
      quantityOf({
        min: 0.58,
        max: 0.58,
        unit: "µmol/l",
        anchor: "held 0.58 ± 0.20 µM phosphate",
      }),
      {
        min: 0.58,
        max: 0.58,
        unit: "µmol/l",
        basis: null,
        normalizedMinMgL: 0.0550826,
        normalizedMaxMgL: 0.0550826,
      },
    );
    // a mass value below a bound: upper only, converted
    assert.deepEqual(
      quantityOf({
        min: 0.1,
        max: 0.1,
        unit: "mg/l",
        basis: "PO4",
        anchor: "highest at < 0.1 mg/L PO4",
      }),
      {
        min: null,
        max: 0.1,
        unit: "mg/l",
        basis: "PO4",
        normalizedMinMgL: null,
        normalizedMaxMgL: 0.1,
      },
    );
    // the stage shape on phosphate: 2-2 given, "< 2" written
    assert.deepEqual(
      quantityOf({
        min: 2,
        max: 2,
        unit: "µmol/l",
        anchor: "kept at phosphate < 2 µmol L−1",
      }),
      {
        min: null,
        max: 2,
        unit: "µmol/l",
        basis: null,
        ...unconverted,
        normalizedMaxMgL: 0.18994,
      },
    );
    // a lower bound, written in words
    assert.deepEqual(
      quantityOf({
        min: 1,
        max: null,
        unit: "µmol/l",
        anchor: "when phosphate exceeded 1 µM",
      }),
      {
        min: 1,
        max: null,
        unit: "µmol/l",
        basis: null,
        ...unconverted,
        normalizedMinMgL: 0.09497,
      },
    );
    // "not exceeding" is an upper bound, not both (barracuda 35814 b)
    assert.deepEqual(
      quantityOf({
        min: 3,
        max: 3,
        unit: "µmol/l",
        anchor: "Tanks not exceeding 3 µM phosphate",
      }),
      {
        min: null,
        max: 3,
        unit: "µmol/l",
        basis: null,
        ...unconverted,
        normalizedMaxMgL: 0.28491,
      },
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
          oaUrl: null,
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
          replaceCandidatesBy?: string;
        }) => {
          calls.push(
            `save:${input.claims.length}:${input.extractedBy}:${input.contentHash.length}${input.runId ? `:${input.runId}` : ""}${input.replaceCandidatesBy ? `:replace=${input.replaceCandidatesBy}` : ""}`,
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

  it("only own findings reach the store, and the study's fields once (acrobot 35808)", async () => {
    const d = deps({
      extractor: {
        extract: async () => ({
          kind: "ANSWER",
          claims: [
            aiClaim(),
            aiClaim(),
            aiClaim({
              passage: { text: "Treatments were 0.5 and 2 µM phosphate." },
            }),
          ],
          refusedClaims: [],
          extractedBy: "m claim-extraction/v1",
        }),
      },
    });
    const outcome = await extractSource("src1", true, d.value);
    assert.equal(outcome.refusedClaims.METHODS_PASSAGE, 1);
    assert.equal(outcome.claims, 2);
    // the second claim's study type and method are the first one's: not stored again
    assert.ok(outcome.fields < 18, String(outcome.fields));
    assert.ok(d.calls.includes("save:2:m claim-extraction/v1:64"));
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

  it("skips, before any request: not included, retracted, already extracted, no PMCID and no open link, not found", async () => {
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

  it("re-extraction: an extracted source is read again and stored in the actor's name; a retracted one still is not (acrobot 35808)", async () => {
    const d = deps(
      { reextract: { actorUserId: "u1" } },
      { alreadyExtracted: true },
    );
    const outcome = await extractSource("src1", true, d.value);
    assert.equal(outcome.status, "EXTRACTED");
    assert.ok(
      d.calls.includes("save:1:m claim-extraction/v1:64:replace=u1"),
      d.calls.join(" "),
    );
    // a preview names no actor and stores nothing
    const preview = deps(
      { reextract: { actorUserId: null } },
      { alreadyExtracted: true },
    );
    assert.equal(
      (await extractSource("src1", false, preview.value)).status,
      "PREVIEWED",
    );
    assert.ok(!preview.calls.some((c) => c.startsWith("save:")));
    const retracted = deps(
      { reextract: { actorUserId: "u1" } },
      { alreadyExtracted: true, retracted: true },
    );
    assert.equal(
      (await extractSource("src1", true, retracted.value)).reason,
      "RETRACTED",
    );
    // without the flag the second read is still skipped
    assert.equal(
      (
        await extractSource(
          "src1",
          true,
          deps({}, { alreadyExtracted: true }).value,
        )
      ).reason,
      "ALREADY_EXTRACTED",
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

  it("no PMCID, an open link: the PDF's text layer goes through the same check and store", async () => {
    const bytes = await pdfOf(PDF_PAGES);
    const pdf = "https://kiado.example.org/cikk.pdf";
    // the AI quotes the text it is sent (its passage and anchors), and pdfjs
    // gives the micro sign as the Greek mu; the unit is a key of its closed list
    const mu = (t: string) => t.replace(/\u00B5/g, "\u03BC");
    const claim = aiClaim() as {
      passage: { text: string };
      fields: { anchor: string }[];
      questions: { anchor: string }[];
    };
    const quoted = {
      ...claim,
      passage: { ...claim.passage, text: mu(claim.passage.text) },
      fields: claim.fields.map((f) => ({ ...f, anchor: mu(f.anchor) })),
      questions: claim.questions.map((q) => ({ ...q, anchor: mu(q.anchor) })),
    };
    const d = deps(
      {
        fetch: async (url) =>
          url === pdf
            ? new Response(bytes, { status: 200 })
            : new Response(null, { status: 404 }),
        extractor: {
          extract: async () => ({
            kind: "ANSWER",
            claims: [quoted],
            refusedClaims: [],
            extractedBy: "m claim-extraction/v1",
          }),
        },
      },
      { pmcid: null, oaUrl: pdf },
    );
    const outcome = await extractSource("src1", true, d.value);
    assert.equal(outcome.status, "EXTRACTED");
    assert.equal(outcome.fullText, "PDF");
    assert.equal(outcome.sections, 2);
    // the same claim as from the JATS: every anchor found verbatim in the PDF's text
    assert.deepEqual(
      [outcome.claims, outcome.fields, outcome.questions],
      [1, 9, 1],
    );
    assert.ok(d.calls.includes("save:1:m claim-extraction/v1:64"));
  });

  it("an open link that is no PDF: skipped with the reason, no AI call", async () => {
    const d = deps(
      {
        fetch: async (url) =>
          url.endsWith("/robots.txt")
            ? new Response(null, { status: 404 })
            : new Response("<html>landing</html>", { status: 200 }),
      },
      { pmcid: null, oaUrl: "https://kiado.example.org/cikk" },
    );
    const outcome = await extractSource("src1", true, d.value);
    assert.deepEqual([outcome.status, outcome.reason], ["SKIPPED", "NOT_PDF"]);
    assert.ok(!d.calls.some((c) => c.startsWith("ai:")));
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

describe("only this source's own findings (acrobot 35808, the first eleven on stage)", () => {
  const base = (over: Partial<CheckedClaim>): CheckedClaim => ({
    passage: {
      text: "Coral calcification decreased by 18 % at 2 µM phosphate.",
      locator: "Results",
    },
    species: null,
    environment: null,
    effect: "CALCIFICATION",
    direction: "DECREASE",
    quantity: null,
    studyType: "CONTROLLED_LAB",
    measurementMethod: null,
    sampleSize: null,
    uncertainty: null,
    conditions: null,
    anchors: [
      {
        field: "effect",
        text: "Calcification decreased",
        locator: "Results",
        normalizedValue: "CALCIFICATION",
      },
      {
        field: "studyType",
        text: "compared with the control",
        locator: "Methods",
        normalizedValue: "CONTROLLED_LAB",
      },
    ],
    refused: [],
    ...over,
  });

  it("a cited result, a methods sentence and a background value are no claims", () => {
    const cases: [Partial<CheckedClaim>, string | null][] = [
      [{}, null],
      [
        {
          passage: {
            text: "As Neil et al. (2025) showed, growth fell.",
            locator: "Discussion",
          },
        },
        "CITED_RESULT",
      ],
      [
        {
          passage: {
            text: "Reef waters hold < 0.1 µM phosphate (Tanaka et al., 2007).",
            locator: "Discussion",
          },
        },
        "CITED_RESULT",
      ],
      [
        {
          passage: {
            text: "Enrichment causes bleaching (Wiedenmann, 2013; Vega Thurber 2014).",
            locator: "Discussion",
          },
        },
        "CITED_RESULT",
      ],
      [
        {
          passage: {
            text: "Wiedenmann (2013) found the same.",
            locator: "Discussion",
          },
        },
        "CITED_RESULT",
      ],
      [
        {
          passage: {
            text: "Phosphate limitation was reported [12, 14].",
            locator: "Discussion",
          },
        },
        "CITED_RESULT",
      ],
      [
        {
          passage: {
            text: "Tissue was homogenised in PBS.",
            locator: "Materials and methods",
          },
        },
        "METHODS_PASSAGE",
      ],
      [
        {
          passage: {
            text: "Nutrients were measured by autoanalyzer.",
            locator: "2. Methods (2/3)",
          },
        },
        "METHODS_PASSAGE",
      ],
      [{ effect: null, direction: null, anchors: [] }, "NO_FINDING"],
      // an effect question still makes it a finding
      [
        {
          effect: null,
          direction: null,
          anchors: [
            {
              field: "effect",
              text: "microbiome composition shifted",
              locator: "Results",
              normalizedValue: null,
              proposed: "MICROBIOMECOMPOSITION",
            },
          ],
        },
        null,
      ],
      // the year of a temperature or a range is no citation
      [
        {
          passage: {
            text: "In 2019 coral growth fell at 2 µM phosphate (n = 12).",
            locator: "Results",
          },
        },
        null,
      ],
    ];
    for (const [over, refusal] of cases) {
      const r = keepOwnFindings([base(over)]);
      assert.deepEqual(
        r.refusedClaims,
        refusal ? [refusal] : [],
        JSON.stringify(over.passage ?? over),
      );
      assert.equal(r.claims.length, refusal ? 0 : 1);
    }
  });

  it("a passage with no word of change is a background value, even with an effect and a direction (acrobot 35941)", () => {
    const inflow = keepOwnFindings([
      base({
        passage: {
          text: "Water was sourced locally from Charlesworth Bay (DIN: 3.35 ± 1.14 µmol/l, DIP: 0.58 ± 0.20 µmol/l; Fig. 2d).",
          locator: "Results",
        },
      }),
    ]);
    assert.deepEqual(inflow.refusedClaims, ["NO_CHANGE_WORD"]);
    assert.equal(inflow.claims.length, 0);
    for (const text of [
      "Shading did not change the internal reserves of the coral.",
      "Lobophora algal cover correlated negatively with total phosphorus.",
      "Symbiont reserves stabilised after 12.5 days of heat stress.",
    ])
      assert.deepEqual(
        keepOwnFindings([base({ passage: { text, locator: "Results" } })])
          .refusedClaims,
        [],
        text,
      );
  });

  it("a change word ends where the word ends: a longer word or an 'effects of' heading is no change (barracuda #1868, acrobot 35987)", () => {
    const refused = (text: string) =>
      keepOwnFindings([base({ passage: { text, locator: "Results" } })])
        .refusedClaims;
    for (const text of [
      "Coral droplets were sampled at the reef.",
      "Coral cover on the fallow reef flat.",
      "Coral samples from the lowermost reef zone.",
      "An alternative coral sampling design.",
      "Effects of phosphate on coral: the study sites.",
    ])
      assert.deepEqual(refused(text), ["NO_CHANGE_WORD"], text);
    for (const text of [
      "Coral reserves stabilised after twelve days.",
      "Coral growth responded to phosphate.",
      "Coral calcification showed a reduction at 2 µM.",
      "Coral growth increasingly slowed with phosphate.",
      "Coral density dropped at 2 µM phosphate.",
      "Phosphate had no significant effect on coral growth.",
      "Phosphate effects on coral calcification were strong.",
      "Coral growth was significantly different between tanks.",
      // barracuda, #1873: the old pattern caught these, so they must stay
      "Coral growth was responding to phosphate.",
      "Coral calcification had fallen by day 30.",
      "Symbiont density had risen at 2 µM.",
      "Coral growth showed a differential response to phosphate.",
      "Coral reserves were stabilizing after heat stress.",
      "Coral growth was highest at 2 µM phosphate.",
      "Coral growth was slowest at 2 µM phosphate.",
    ])
      assert.deepEqual(refused(text), [], text);
  });

  it("a claim with no species and no organism in its passage is no claim (acrobot 35963)", () => {
    const fish = {
      text: "Fish-derived phosphorus supply rates increased at nutrient hotspots.",
      locator: "Results",
    };
    const without = keepOwnFindings([base({ passage: fish })]);
    assert.deepEqual(without.refusedClaims, ["NO_ORGANISM"]);
    assert.equal(without.claims.length, 0);
    // a species field, even a question, names the organism
    const withSpecies = keepOwnFindings([
      base({
        passage: fish,
        anchors: [
          {
            field: "species",
            text: "A. cervicornis",
            locator: "Results",
            normalizedValue: null,
            proposed: "A. cervicornis",
          },
        ],
      }),
    ]);
    assert.deepEqual(withSpecies.refusedClaims, []);
    for (const text of [
      "Macroalgal tissue phosphorus increased near fish hotspots.",
      "Zooxanthellae density increased under phosphate enrichment.",
      "Calcification decreased in aquarium-reared Acropora at 2 µM phosphate.",
      "Scleractinian growth declined with phosphate.",
    ])
      assert.deepEqual(
        keepOwnFindings([base({ passage: { text, locator: "Results" } })])
          .refusedClaims,
        [],
        text,
      );
  });

  it("a genus or species the approved vocabulary holds names the organism too (barracuda #1871, acrobot 35969)", () => {
    const vocabulary = vocabularyV1();
    const refused = (text: string, v?: ReturnType<typeof vocabularyV1>) =>
      keepOwnFindings([base({ passage: { text, locator: "Results" } })], v)
        .refusedClaims;
    // a genus the hand-written stems do not know
    const seriatopora = "Seriatopora calcification decreased under phosphate.";
    assert.deepEqual(refused(seriatopora), ["NO_ORGANISM"]);
    assert.deepEqual(refused(seriatopora, vocabulary), []);
    // a species name the vocabulary writes in full
    assert.deepEqual(
      refused("Seriatopora hystrix growth declined at 2 µM.", vocabulary),
      [],
    );
    // what the vocabulary does not hold stays refused
    assert.deepEqual(
      refused("Lobophora cover correlated with total phosphorus.", vocabulary),
      ["NO_ORGANISM"],
    );
    assert.deepEqual(
      refused(
        "Fish-derived phosphorus supply increased at hotspots.",
        vocabulary,
      ),
      ["NO_ORGANISM"],
    );
  });

  it("an effect key its anchor does not name becomes a question in the anchor's words; a named or an editor's key stays (acrobot 35941)", () => {
    const effect = (text: string, key: string) =>
      keepOwnFindings([
        base({
          effect: key,
          anchors: [
            { field: "effect", text, locator: "Results", normalizedValue: key },
          ],
        }),
      ]).claims[0]!;
    const reserve = effect(
      "internal nitrogen reserves increased to 96–97 % of the maximum",
      "SYMBIONT_DENSITY",
    );
    assert.equal(reserve.effect, null);
    assert.equal(reserve.anchors[0]!.normalizedValue, null);
    assert.match(
      reserve.anchors[0]!.proposed ?? "",
      /^internal nitrogen reserves increased to 96/,
    );
    for (const [text, key] of [
      ["symbiont cell density increased", "SYMBIONT_DENSITY"],
      ["zooxanthellae density fell", "SYMBIONT_DENSITY"],
      ["Calcification decreased", "CALCIFICATION"],
      ["Fv/Fm declined", "PHOTOSYNTHESIS"],
      ["microbiome composition shifted", "MICROBIOMECOMPOSITION"],
    ] as const) {
      const kept = effect(text, key);
      assert.equal(kept.effect, key, text);
      assert.equal(kept.anchors[0]!.normalizedValue, key, text);
    }
  });

  it("the study's own fields once per source; two different values keep neither", () => {
    const same = keepOwnFindings([base({}), base({}), base({})]);
    assert.deepEqual(
      same.claims.map(
        (c) => c.anchors.filter((a) => a.field === "studyType").length,
      ),
      [1, 0, 0],
    );
    assert.deepEqual(same.refusedFields, []);
    const differ = keepOwnFindings([
      base({}),
      base({
        studyType: "MODELLING",
        anchors: [
          {
            field: "effect",
            text: "Calcification decreased",
            locator: "Results",
            normalizedValue: "CALCIFICATION",
          },
          {
            field: "measurementMethod",
            text: "measured by autoanalyzer",
            locator: "Methods",
            normalizedValue: "AUTOANALYZER",
          },
          {
            field: "studyType",
            text: "a photophysiological model",
            locator: "Abstract",
            normalizedValue: "MODELLING",
          },
        ],
      }),
    ]);
    assert.deepEqual(differ.refusedFields, ["SOURCE_FIELD_CONFLICT"]);
    assert.ok(
      differ.claims.every(
        (c) =>
          c.studyType === null &&
          !c.anchors.some((a) => a.field === "studyType"),
      ),
    );
    // the other source field is untouched
    assert.equal(
      differ.claims[1]!.anchors.filter((a) => a.field === "measurementMethod")
        .length,
      1,
    );
  });
});
