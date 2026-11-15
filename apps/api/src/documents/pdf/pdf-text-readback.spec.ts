import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addPage,
  createBrandedPdf,
  PDF_REGULAR_FONT,
  registerNotoSans,
} from "./branded-document.js";
import {
  pdfDocumentParams,
  PdfReadLimitError,
  readPdfTextLines,
} from "./pdf-text-readback.js";

/*
  THE PDF READER ON FOREIGN INPUT (barracuda on #2585). What turns these red:
  an uploaded PDF read with pdf.js's eval path or font loading on; a file
  that declares more pages than the limit read anyway; a page with more text
  pieces than the limit grouped anyway; our own PDF no longer read back the
  same way under the untrusted options; the default reader changed.
*/

async function pdf(pages: string[][]): Promise<Buffer> {
  const doc = createBrandedPdf({
    creationDate: new Date("2026-11-15T00:00:00Z"),
  });
  registerNotoSans(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  pages.forEach((lines, i) => {
    if (i > 0) addPage(doc);
    lines.forEach((line, j) =>
      doc
        .font(PDF_REGULAR_FONT)
        .fontSize(10)
        .text(line, 54, 72 + j * 14),
    );
  });
  doc.end();
  return done;
}

describe("pdfDocumentParams", () => {
  it("turns off eval and font loading for an untrusted file, and only then", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const own = pdfDocumentParams(bytes) as Record<string, unknown>;
    assert.equal("isEvalSupported" in own, false);
    assert.equal("disableFontFace" in own, false);
    const foreign = pdfDocumentParams(bytes, { untrusted: true }) as Record<
      string,
      unknown
    >;
    assert.equal(foreign.isEvalSupported, false);
    assert.equal(foreign.disableFontFace, true);
    assert.equal(foreign.useSystemFonts, false);
  });
});

describe("readPdfTextLines limits", () => {
  it("refuses a file with more pages than the limit, and reads one within it", async () => {
    const bytes = await pdf([["Első oldal"], ["Második"], ["Harmadik"]]);
    await assert.rejects(
      readPdfTextLines(bytes, { untrusted: true, maxPages: 2 }),
      (error: unknown) =>
        error instanceof PdfReadLimitError &&
        error.what === "pages" &&
        error.found === 3 &&
        error.limit === 2,
    );
    const lines = await readPdfTextLines(bytes, {
      untrusted: true,
      maxPages: 3,
    });
    assert.deepEqual(
      lines.map((l) => [l.pageNumber, l.text]),
      [
        [1, "Első oldal"],
        [2, "Második"],
        [3, "Harmadik"],
      ],
    );
  });

  it("refuses a page with more text pieces than the limit", async () => {
    const bytes = await pdf([
      Array.from({ length: 30 }, (_, i) => `Sor ${i + 1}`),
    ]);
    await assert.rejects(
      readPdfTextLines(bytes, { untrusted: true, maxItemsPerPage: 10 }),
      (error: unknown) =>
        error instanceof PdfReadLimitError && error.what === "items",
    );
    assert.equal(
      (
        await readPdfTextLines(bytes, {
          untrusted: true,
          maxItemsPerPage: 1_000,
        })
      ).length,
      30,
    );
  });

  it("reads our own text the same with and without the untrusted options", async () => {
    const bytes = await pdf([
      ["Ősszel a víz hűvösebb.", "Árvíztűrő tükörfúrógép"],
    ]);
    const own = await readPdfTextLines(bytes);
    const foreign = await readPdfTextLines(bytes, {
      untrusted: true,
      maxPages: 200,
      maxItemsPerPage: 5_000,
    });
    assert.deepEqual(
      foreign.map((l) => l.text),
      own.map((l) => l.text),
    );
    assert.deepEqual(
      own.map((l) => l.text),
      ["Ősszel a víz hűvösebb.", "Árvíztűrő tükörfúrógép"],
    );
  });
});
