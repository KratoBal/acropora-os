import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import {
  collectedPdfIds,
  collectedPdfIndex,
} from "../billing/incoming-collected-pdf.js";
import { scanAsPdf } from "./purchase-invoice-scan.js";

/** A 2×1 pixel PNG, built at run time (no binary fixture in the repo). */
async function tinyPng(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  void pdf;
  // a minimal valid PNG: signature, IHDR, IDAT, IEND
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQYGBgAKfwF+yHbvgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

describe("a scanned invoice (card 5ec62e35)", () => {
  it("a PNG becomes a one-page A4 PDF named after the file", async () => {
    const result = await scanAsPdf(await tinyPng(), "png", "szamla-lapja.png");
    assert.equal(result.fileName, "szamla-lapja.pdf");
    const pdf = await PDFDocument.load(result.bytes);
    assert.equal(pdf.getPageCount(), 1);
    const { width, height } = pdf.getPage(0).getSize();
    assert.deepEqual([Math.round(width), Math.round(height)], [595, 842]);
  });

  it("a PDF is kept as it came", async () => {
    const source = await (await PDFDocument.create()).save();
    const result = await scanAsPdf(source, "pdf", "eredeti.pdf");
    assert.equal(result.bytes, source);
    assert.equal(result.fileName, "eredeti.pdf");
  });

  it("for one invoice key, the directly attached scan comes first", () => {
    const reading = {
      invoiceNumber: "2026-17",
      supplierTaxNumber: "12345678-2-42",
    };
    const index = collectedPdfIndex([
      {
        id: "older-mail",
        fileName: "a.pdf",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        textReading: reading,
        importResult: null,
        purchaseInvoiceId: null,
      },
      {
        id: "attached-scan",
        fileName: "b.pdf",
        createdAt: new Date("2026-10-08T00:00:00Z"),
        textReading: reading,
        importResult: null,
        purchaseInvoiceId: "pi-1",
      },
    ]);
    assert.deepEqual(
      collectedPdfIds(
        {
          documentNumber: "2026-17",
          supplierTaxNumber: "12345678-2-42",
          sourceDocumentId: null,
        },
        index,
      ),
      ["attached-scan", "older-mail"],
    );
  });
});
