import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vocabularyV1 } from "@acropora/knowledge-base";

import type {
  ClaimExtractor,
  FigureClaimExtractor,
  FigureExtractionInput,
  FigureExtractorAnswer,
} from "./claim-extractor.js";
import { figureAnswerOf } from "./claim-extractor.js";
import {
  emptyOutcome,
  FIGURE_TILE_MAX_BYTES,
  readFullTextClaims,
  type TextFetch,
} from "./extraction-run.js";
import { aiClaim, JATS } from "./extraction-test-fixtures.js";
import {
  captionNamesPhosphate,
  figureImageLocator,
  jatsFigures,
} from "./jats-figures.js";
import {
  fetchPmcFigureImage,
  figureKey,
  MAX_FIGURE_BYTES,
  PMC_OA_BUCKET,
} from "./pmc-figure-image.js";

/**
 * THE FIGURES' IMAGE READING, THE OS SIDE (research-kepes-ut, slice 3). WHAT
 * TURNS IT RED: a figure whose caption does not name the subject read (a paid
 * call for nothing); a passage that stands only in the model's transcript
 * stored as verified; a verified claim carrying a number only the transcript
 * holds; the study's own fields taken from a figure; the AI's own word on
 * where a passage stands trusted; a figure reading without its switch; an
 * image that is not a PNG or JPEG decoded. Invented text, a generated image.
 */
const vocabulary = vocabularyV1();

const CAPTION_TEXT =
  "Calcification of Acropora millepora decreased at higher phosphate levels.";
const FIG = `<fig id="f1" position="float"><label>Figure 1</label><caption><title>Phosphate series.</title><p>${CAPTION_TEXT}</p></caption><graphic xlink:href="paper-fig1.jpg"/></fig>`;
const NO_SUBJECT = `<fig id="f2"><label>Figure 2</label><caption><p>Map of the reef.</p></caption><graphic xlink:href="paper-fig2.jpg"/></fig>`;
/**
 * The fixture paper with two figures in a <floats-group> (outside the body,
 * so their captions are not in the sections), one naming phosphate.
 */
const XML = JATS.replace(
  "</back>",
  `</back><floats-group>${FIG}${NO_SUBJECT}</floats-group>`,
);
const CAPTION = "Phosphate series.\n" + CAPTION_TEXT;
const TRANSCRIPT = "PO4 (µM) | 0 | 0.5 | 2 |\nCalcification fell at 2 µM PO4";

async function pngOf(width: number, height: number): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer(),
  );
}

const listing = (keys: string[]) =>
  `<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join("")}</ListBucketResult>`;

/** Europe PMC's JATS, the bucket's listing and its image; every URL asked is kept. */
function fakeFetch(image: Uint8Array, asked: string[]): TextFetch {
  return async (url) => {
    asked.push(url);
    if (url.includes("europepmc")) return new Response(XML, { status: 200 });
    if (url.startsWith(`${PMC_OA_BUCKET}/?`))
      return new Response(
        listing([
          "PMC123.1/paper-fig1.jpg",
          "PMC123.2/paper-fig1.jpg",
          "PMC123.2/paper.pdf",
        ]),
        { status: 200 },
      );
    if (url === `${PMC_OA_BUCKET}/PMC123.2/paper-fig1.jpg`)
      return new Response(Uint8Array.from(image), { status: 200 });
    return new Response("no", { status: 404 });
  };
}

const textExtractor: ClaimExtractor = {
  extract: async () => ({
    kind: "ANSWER",
    claims: [aiClaim()],
    refusedClaims: [],
    refusalDetails: [],
    extractedBy: "gpt-5.1 claim-extraction/v3",
  }),
};

function figureExtractor(
  claims: unknown[],
  seen: FigureExtractionInput[] = [],
): FigureClaimExtractor {
  return {
    extract: async (input): Promise<FigureExtractorAnswer> => {
      seen.push(input);
      return {
        kind: "ANSWER",
        claims,
        refusedClaims: ["PASSAGE_ACROSS_PARTS"],
        refusalDetails: [],
        extractedBy: "gpt-5.1 figure-claim-extraction/v1",
        transcripts: [TRANSCRIPT],
      };
    },
  };
}

/** A figure claim as the AI service sends it. */
const figureClaim = (passage: string, fields: unknown[]) => ({
  passage: { text: passage, locator: "panel A" },
  fields,
  refusedFields: [],
  questions: [],
  // the AI's own word; the OS locates every text itself
  origin: { part: "CAPTION" },
});

describe("the figures of a JATS", () => {
  it("label, caption and image file; a <fig-count> is no figure, the back matter is left out", () => {
    const xml = `<article><front><counts><fig-count count="2"/></counts></front><body>${FIG}${NO_SUBJECT}<fig id="nolabel"><caption><p>x</p></caption><graphic xlink:href="g3"/></fig><fig id="noimage"><caption><p>phosphate</p></caption></fig></body><back><fig id="b"><label>Figure S1</label><caption><p>phosphate</p></caption><graphic xlink:href="s1.jpg"/></fig></back></article>`;
    const figures = jatsFigures(xml);
    assert.deepEqual(
      figures.map((f) => [f.label, f.href]),
      [
        ["Figure 1", "paper-fig1.jpg"],
        ["Figure 2", "paper-fig2.jpg"],
        ["nolabel", "g3"],
      ],
    );
    assert.equal(figures[0]!.caption, CAPTION);
  });

  it("only a caption that names the subject is a candidate (the measurement's words)", () => {
    assert.equal(captionNamesPhosphate(CAPTION), true);
    assert.equal(captionNamesPhosphate("SRP and DIN over time"), true);
    assert.equal(captionNamesPhosphate("Map of the reef."), false);
  });
});

describe("a figure's image from the PMC open-access dataset", () => {
  it("the newest version's key, an extension-less name as .jpg, never another article's", () => {
    const xml = listing([
      "PMC1.1/a.jpg",
      "PMC1.3/a.jpg",
      "PMC1.2/a.jpg",
      "PMC12.9/a.jpg",
      "PMC1.3/b.png",
    ]);
    assert.equal(figureKey(xml, "PMC1", "a.jpg"), "PMC1.3/a.jpg");
    assert.equal(figureKey(xml, "PMC1", "a"), "PMC1.3/a.jpg");
    assert.equal(figureKey(xml, "PMC1", "b"), "PMC1.3/b.png");
    assert.equal(figureKey(xml, "PMC1", "c.jpg"), null);
  });

  it("a PNG or JPEG only, by its bytes; a bad name is not asked for at all", async () => {
    const png = await pngOf(300, 300);
    const asked: string[] = [];
    const ok = await fetchPmcFigureImage(
      "PMC123",
      "paper-fig1.jpg",
      fakeFetch(png, asked),
    );
    assert.ok(ok.ok);
    assert.equal(ok.key, "PMC123.2/paper-fig1.jpg");
    const gif = new TextEncoder().encode("GIF89a........");
    assert.deepEqual(
      await fetchPmcFigureImage("PMC123", "paper-fig1.jpg", fakeFetch(gif, [])),
      { ok: false, reason: "NOT_PNG_OR_JPEG" },
    );
    assert.deepEqual(
      await fetchPmcFigureImage("PMC123", "missing.jpg", fakeFetch(png, [])),
      { ok: false, reason: "NOT_IN_DATASET" },
    );
    const none: string[] = [];
    assert.deepEqual(
      await fetchPmcFigureImage("PMC123", "../x.jpg", fakeFetch(png, none)),
      { ok: false, reason: "BAD_NAME" },
    );
    assert.deepEqual(none, []);
  });

  it("an image over the cap is refused while read, not after", async () => {
    const big = new Uint8Array(MAX_FIGURE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    assert.deepEqual(
      await fetchPmcFigureImage("PMC123", "paper-fig1.jpg", fakeFetch(big, [])),
      { ok: false, reason: "TOO_LARGE" },
    );
  });
});

describe("the figure answer from the AI service", () => {
  it("a transcript list of the wrong length is UNAVAILABLE, not claims", () => {
    const body = { claims: [], refusedClaims: [], extractedBy: "x" };
    assert.equal(
      figureAnswerOf({ ...body, transcripts: ["a"] }, 1).kind,
      "ANSWER",
    );
    assert.deepEqual(figureAnswerOf({ ...body, transcripts: [] }, 1), {
      kind: "UNAVAILABLE",
      reason: "no transcripts",
    });
    assert.equal(figureAnswerOf(body, 1).kind, "UNAVAILABLE");
  });
});

describe("readFullTextClaims with the figures", () => {
  const verifiedPassage =
    "Calcification decreased by 18 % at 2 µM phosphate compared with the control (± 3.1 SE).";
  const claims = [
    // its passage is the caption: downloaded text, verified, so a transcript number may not ride on it
    figureClaim(CAPTION_TEXT, [
      {
        field: "effect",
        value: "CALCIFICATION",
        anchor: "Calcification of Acropora millepora decreased",
      },
      {
        field: "direction",
        value: "DECREASE",
        anchor: "decreased at higher phosphate",
      },
      {
        field: "species",
        value: "ACROPORA_MILLEPORA",
        anchor: "Calcification of Acropora millepora",
      },
      {
        field: "quantity",
        min: 2,
        max: 2,
        unit: "µmol/l",
        basis: null,
        anchor: "2 µM PO4",
      },
    ]),
    // its passage is the paper's sections: the text call's, dropped as a twin
    figureClaim(verifiedPassage, [
      {
        field: "effect",
        value: "CALCIFICATION",
        anchor: "Calcification decreased",
      },
    ]),
    // its passage is the transcript: the model's reading, not verified
    figureClaim("Calcification fell at 2 µM PO4", [
      { field: "effect", value: "CALCIFICATION", anchor: "Calcification fell" },
      { field: "direction", value: "DECREASE", anchor: "Calcification fell" },
      {
        field: "species",
        value: "ACROPORA_MILLEPORA",
        anchor: "Calcification of Acropora millepora",
      },
      {
        field: "quantity",
        min: 2,
        max: 2,
        unit: "µmol/l",
        basis: null,
        anchor: "2 µM PO4",
      },
      {
        field: "studyType",
        value: "CONTROLLED_LAB",
        anchor: "Calcification fell at 2 µM PO4",
      },
    ]),
  ];

  it("FIGURE-READ: the candidate figure only; a transcript passage unverified; anchors in their own part", async () => {
    const asked: string[] = [];
    const seen: FigureExtractionInput[] = [];
    const outcome = emptyOutcome("s1");
    const read = await readFullTextClaims("PMC123", outcome, {
      extractor: textExtractor,
      figureExtractor: figureExtractor(claims, seen),
      fetch: fakeFetch(await pngOf(756, 266), asked),
      vocabulary,
    });
    assert.ok(read.ok);

    // one figure asked for (the caption without phosphate is not), as PNG tiles within the caps
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.figure, "Figure 1");
    assert.equal(seen[0]!.caption, CAPTION);
    assert.equal(seen[0]!.images.length, 1);
    assert.equal(seen[0]!.images[0]!.contentType, "image/png");
    assert.ok(seen[0]!.images[0]!.bytes.byteLength <= FIGURE_TILE_MAX_BYTES);
    assert.equal(asked.filter((u) => u.includes("paper-fig2")).length, 0);

    // the text claim, then the two figure claims
    assert.equal(read.claims.length, 3);
    const [, onText, onImage] = read.claims;
    const imageLocator = figureImageLocator("Figure 1", 1, 1);
    assert.deepEqual(read.unverifiedLocators, [imageLocator]);

    // the OS located it, whatever the AI said: the caption, verified
    assert.equal(onText!.passage.locator, "Figure 1, caption");
    assert.equal(onText!.extractedBy, "gpt-5.1 figure-claim-extraction/v1");
    assert.equal(
      onText!.quantity,
      null,
      "the transcript's number does not ride on a verified claim",
    );
    assert.deepEqual(
      onText!.refused.filter((r) => r.refusal === "ANCHOR_ACROSS_PARTS"),
      [{ field: "quantity", refusal: "ANCHOR_ACROSS_PARTS" }],
    );
    assert.equal(
      onText!.anchors.find((a) => a.field === "species")?.locator,
      "Figure 1, caption",
      "the caption is downloaded text: an anchor there is kept",
    );

    // the transcript claim: its own tile's number kept, the caption's species kept, no study fields
    assert.equal(onImage!.passage.locator, imageLocator);
    assert.equal(onImage!.quantity?.normalizedMinMgL, 0.18994);
    assert.equal(onImage!.species, "ACROPORA_MILLEPORA");
    assert.equal(onImage!.studyType, null);
    assert.ok(
      onImage!.refused.some(
        (r) =>
          r.field === "studyType" && r.refusal === "SOURCE_FIELD_FROM_FIGURE",
      ),
    );

    // the outcome counts, never a text
    assert.deepEqual(
      {
        ...outcome.figures,
        refusedFields: undefined,
        refusedClaims: undefined,
      },
      {
        candidates: 1,
        dropped: 0,
        skipped: {},
        calls: 1,
        tiles: 1,
        claims: 2,
        fromImage: 1,
        refusalDetails: [],
        refusedFields: undefined,
        refusedClaims: undefined,
      },
    );
    assert.equal(outcome.figures!.refusedClaims.AI_PASSAGE_ACROSS_PARTS, 1);
    assert.equal(outcome.figures!.refusedClaims.PASSAGE_IN_TEXT, 1);
    assert.equal(outcome.figures!.refusedFields.ANCHOR_ACROSS_PARTS, 1);
    assert.equal(outcome.claims, 3);
  });

  it("without the figure extractor nothing of the figures runs, and the outcome says so", async () => {
    const asked: string[] = [];
    const outcome = emptyOutcome("s1");
    const read = await readFullTextClaims("PMC123", outcome, {
      extractor: textExtractor,
      fetch: fakeFetch(await pngOf(300, 300), asked),
      vocabulary,
    });
    assert.ok(read.ok);
    assert.equal(read.claims.length, 1);
    assert.equal(read.unverifiedLocators, undefined);
    assert.equal(outcome.figures, null);
    assert.deepEqual(
      asked.filter((u) => !u.includes("europepmc")),
      [],
    );
  });

  it("a figure whose image cannot be had is counted by reason, and the text claims stay", async () => {
    const outcome = emptyOutcome("s1");
    const gif = new TextEncoder().encode("GIF89a........");
    const read = await readFullTextClaims("PMC123", outcome, {
      extractor: textExtractor,
      figureExtractor: figureExtractor(claims),
      fetch: fakeFetch(gif, []),
      vocabulary,
    });
    assert.ok(read.ok);
    assert.equal(read.claims.length, 1);
    assert.deepEqual(outcome.figures!.skipped, { IMAGE_NOT_PNG_OR_JPEG: 1 });
    assert.equal(outcome.figures!.calls, 0);
  });
});
