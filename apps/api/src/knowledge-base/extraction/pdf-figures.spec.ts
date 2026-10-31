import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vocabularyV1 } from "@acropora/knowledge-base";

import type {
  ClaimExtractor,
  FigureClaimExtractor,
  FigureExtractionInput,
} from "./claim-extractor.js";
import { emptyOutcome, readManualPdfClaims } from "./extraction-run.js";
import { PDF_PAGES } from "./extraction-test-fixtures.js";
import {
  RENDER_LONG_SIDE,
  pdfFigureCaptions,
  pdfPhosphateFigures,
  renderPdfPages,
} from "./pdf-figures.js";
import { pdfSections } from "./pdf-full-text.js";

/**
 * A PDF'S FIGURES (research-kepes-ut, slice 4). WHAT TURNS IT RED: a caption
 * that runs into the next figure or table; a page's figure not found because
 * it stands after the references (a manuscript's figure pages); a vector chart
 * not drawn (only raster images rendered); a page drawn at a size the tiler
 * then has to shrink; a figure page read for claims; a transcript passage of a
 * PDF figure stored as verified. Invented text, a generated PDF.
 */
const vocabulary = vocabularyV1();

const CAPTION_1 = "Fig. 1 Calcification of Acropora millepora decreased at";
const CAPTION_2 = "higher phosphate levels in the tanks.";

/** Pages of text lines, with a red vector rectangle on the pages listed. */
async function pdfWith(
  pages: readonly string[][],
  drawOn: readonly number[] = [],
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, n) => {
    const page = doc.addPage([1200, 800]);
    lines.forEach((line, i) =>
      page.drawText(line, { x: 20, y: 760 - i * 20, size: 10, font }),
    );
    if (drawOn.includes(n + 1))
      page.drawRectangle({
        x: 600,
        y: 100,
        width: 400,
        height: 300,
        color: rgb(1, 0, 0),
      });
  });
  return new Uint8Array(await doc.save());
}

describe("a PDF's figure captions", () => {
  const sections = [
    {
      locator: "p. 2",
      text: [
        "Results text.",
        CAPTION_1,
        CAPTION_2,
        "Table 1 Water chemistry.",
        "Figure 2 Map of the reef.",
        "FIG. 3b PO4 over time.",
      ].join("\n"),
    },
    { locator: "Abstract", text: "Fig. 9 phosphate: not a page section" },
  ];

  it("a caption runs to the next figure or table, keeps its lines as the page holds them, and names its page", () => {
    assert.deepEqual(pdfFigureCaptions(sections), [
      { label: "Fig. 1", page: 2, caption: `${CAPTION_1}\n${CAPTION_2}` },
      { label: "Figure 2", page: 2, caption: "Figure 2 Map of the reef." },
      { label: "FIG. 3b", page: 2, caption: "FIG. 3b PO4 over time." },
    ]);
  });

  it("only a caption naming the subject is a candidate", () => {
    assert.deepEqual(
      pdfPhosphateFigures(sections).map((f) => f.label),
      ["Fig. 1", "FIG. 3b"],
    );
  });

  it("the pages after the references are kept for captions, never for claims", async () => {
    const read = await pdfSections(
      await pdfWith([...PDF_PAGES, [CAPTION_1, CAPTION_2]]),
    );
    assert.deepEqual(
      read.sections.map((s) => s.locator),
      ["p. 1", "p. 2"],
    );
    assert.doesNotMatch(
      read.sections.map((s) => s.text).join("\n"),
      /Kitalált Hivatkozás|Fig\. 1/,
    );
    assert.deepEqual(
      read.afterReferences.map((s) => s.locator),
      ["p. 3"],
    );
    assert.deepEqual(
      pdfPhosphateFigures(read.afterReferences).map((f) => [f.label, f.page]),
      [["Fig. 1", 3]],
    );
  });
});

describe("a PDF's pages, rendered", () => {
  it("a vector drawing is drawn, at the size a 2 x 2 grid holds, and a page out of range is left out", async () => {
    const pages = await renderPdfPages(await pdfWith([["text"]], [1]), [1, 9]);
    assert.deepEqual([...pages.keys()], [1]);
    const { default: sharp } = await import("sharp");
    const png = Buffer.from(pages.get(1)!);
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, "png");
    assert.equal(Math.max(meta.width!, meta.height!), RENDER_LONG_SIDE);
    // the rectangle's middle (x 800 of 1200, y 250 of 800 from the bottom) is red
    const scale = RENDER_LONG_SIDE / 1200;
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at =
      (Math.round((800 - 250) * scale) * info.width + Math.round(800 * scale)) *
      3;
    assert.deepEqual([data[at], data[at + 1], data[at + 2]], [255, 0, 0]);
    // and the background is white, not transparent black
    assert.deepEqual([data[0], data[1], data[2]], [255, 255, 255]);
  });
});

describe("readManualPdfClaims with the figures", () => {
  const text: ClaimExtractor = {
    extract: async () => ({
      kind: "ANSWER",
      claims: [],
      refusedClaims: [],
      refusalDetails: [],
      extractedBy: "gpt-5.1 claim-extraction/v3",
    }),
  };
  const transcript = "Calcification fell at 2 µM PO4";
  const figure = (seen: FigureExtractionInput[]): FigureClaimExtractor => ({
    extract: async (input) => {
      seen.push(input);
      return {
        kind: "ANSWER",
        claims: [
          {
            passage: { text: transcript, locator: "x" },
            fields: [
              {
                field: "effect",
                value: "CALCIFICATION",
                anchor: "Calcification fell",
              },
              {
                field: "direction",
                value: "DECREASE",
                anchor: "Calcification fell",
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
            ],
            refusedFields: [],
            questions: [],
          },
        ],
        refusedClaims: [],
        refusalDetails: [],
        extractedBy: "gpt-5.1 figure-claim-extraction/v1",
        transcripts: input.images.map((_, i) => (i === 3 ? transcript : "")),
        readings: input.images.map(() => ""),
      };
    },
  });

  it("PDF-FIGURE-READ: the figure page rendered and tiled, its caption from the text layer, the transcript claim unverified", async () => {
    const seen: FigureExtractionInput[] = [];
    const outcome = emptyOutcome("s1");
    const read = await readManualPdfClaims(
      await pdfWith([[...PDF_PAGES[0]!, CAPTION_1, CAPTION_2]], [1]),
      outcome,
      {
        extractor: text,
        figureExtractor: figure(seen),
        fetch: async () => new Response(null, { status: 599 }),
        vocabulary,
      },
    );
    assert.ok(read.ok);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.figure, "Fig. 1");
    assert.equal(seen[0]!.caption, `${CAPTION_1}\n${CAPTION_2}`);
    assert.equal(
      seen[0]!.images.length,
      4,
      "a 1200 x 800 page at 3040 px: 2 x 2",
    );
    assert.equal(read.claims.length, 1);
    const [claim] = read.claims;
    assert.equal(claim!.passage.locator, "Fig. 1, p. 1, image tile 4/4");
    assert.deepEqual(
      read.unverifiedLocators,
      [1, 2, 3, 4].map((i) => `Fig. 1, p. 1, image tile ${i}/4`),
    );
    // the species anchor is the caption, which is the page's text: verified
    assert.equal(
      claim!.anchors.find((a) => a.field === "species")?.locator,
      "p. 1",
    );
    assert.equal(claim!.quantity?.normalizedMinMgL, 0.18994);
    assert.equal(outcome.figures?.calls, 1);
    assert.equal(outcome.figures?.tiles, 4);
    assert.equal(outcome.figures?.fromImage, 1);
  });

  it("without the figure extractor the page is not rendered and nothing of the figures runs", async () => {
    const outcome = emptyOutcome("s1");
    const read = await readManualPdfClaims(
      await pdfWith([[...PDF_PAGES[0]!, CAPTION_1, CAPTION_2]], [1]),
      outcome,
      {
        extractor: text,
        fetch: async () => new Response(null, { status: 599 }),
        vocabulary,
      },
    );
    assert.ok(read.ok);
    assert.equal(outcome.figures, null);
    assert.equal(read.unverifiedLocators, undefined);
  });
});
