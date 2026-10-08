import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import {
  collectedPdfIds,
  collectedPdfIndex,
} from "../billing/incoming-collected-pdf.js";
import {
  MAX_PNG_DECODED_BYTES,
  pngDecodedBytes,
  scanAsPdf,
  ScanTooLarge,
  ScanUnreadable,
} from "./purchase-invoice-scan.js";

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

  it("a small PNG that declares a giant canvas is refused before it is decoded", async () => {
    const giant = Uint8Array.from(await tinyPng());
    const view = new DataView(giant.buffer);
    view.setUint32(16, 100_000); // width
    view.setUint32(20, 100_000); // height: 10 000 MP declared
    assert.ok(100_000 * 100_000 * 4 > MAX_PNG_DECODED_BYTES);
    await assert.rejects(scanAsPdf(giant, "png", "x.png"), ScanTooLarge);
  });

  // MI PIROSÍT: a pixelszámra kötött korlát (40 MP) átengedi a 20 MP-s,
  // 16 bites RGBA képet, pedig dekódolva 160 MB (barracuda, acrobot 28131)
  it("the limit is the decoded size: a 16-bit RGBA under 25 MP is still too large", async () => {
    const deep = Uint8Array.from(await tinyPng());
    const view = new DataView(deep.buffer);
    view.setUint32(16, 5000); // width
    view.setUint32(20, 4000); // height: 20 MP
    deep[24] = 16; // bit depth
    deep[25] = 6; // RGBA
    await assert.rejects(
      scanAsPdf(deep, "png", "x.png"),
      ScanTooLarge,
      "BYTES-16BIT",
    );
  });

  it("what decoding costs: the raw size, never less than 8-bit RGBA", () => {
    const of = (bitDepth: number, channels: number) =>
      pngDecodedBytes({ width: 1000, height: 1000, bitDepth, channels });
    assert.deepEqual(
      [of(16, 4), of(8, 4), of(8, 3), of(8, 1), of(1, 1)],
      [8_000_000, 4_000_000, 4_000_000, 4_000_000, 4_000_000],
    );
    // an 8-bit scan of 24 MP passes, of 26 MP does not
    assert.ok(
      pngDecodedBytes({
        width: 6000,
        height: 4000,
        bitDepth: 8,
        channels: 3,
      }) <= MAX_PNG_DECODED_BYTES,
    );
    assert.ok(
      pngDecodedBytes({ width: 6500, height: 4000, bitDepth: 8, channels: 3 }) >
        MAX_PNG_DECODED_BYTES,
    );
  });

  it("a broken image behind a good signature is unreadable, not a crash", async () => {
    const png = await tinyPng();
    const broken = Uint8Array.from([...png.subarray(0, 33), 1, 2, 3, 4, 5]);
    await assert.rejects(scanAsPdf(broken, "png", "x.png"), ScanUnreadable);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
    await assert.rejects(scanAsPdf(jpeg, "jpeg", "x.jpg"), ScanUnreadable);
  });
});
