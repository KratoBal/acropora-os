import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../../documents/pdf/branded-document.js";
import { HERTLEIN_PDF_LINES } from "../../testing/hertlein-invoice-pdf-lines.fixture.js";
import { PAGE_END_MARKER } from "./pdf-text-lines.js";
import { SupplierInvoiceImportError } from "./supplier-invoice-import.error.js";
import { SupplierInvoiceImportService } from "./supplier-invoice-import.service.js";

/**
 * A szintetikus Hertlein-sorokból VALÓDI PDF: minden cella külön szövegként,
 * a sor cellái azonos magasságban, egymás mellett -- ahogy egy táblázatos
 * számla-PDF-ben állnak. Így a teljes út fut: PDF -> `pdfjs` -> sorok ->
 * illesztő, nem csak az illesztő egy kész sorlistán.
 */
/**
 * Column x positions, wide apart as on the real invoice: `pdfjs` merges two
 * text items into one when the gap between them is small, and a cramped
 * synthetic layout would test that merge, not the invoice.
 */
const COLUMNS = [20, 90, 330, 390, 450, 510];

function tablePdf(lines: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc).fontSize(8);
    let y = 30;
    let first = true;
    for (const line of lines) {
      if (line === PAGE_END_MARKER) {
        first = false;
        continue;
      }
      if (!first) {
        doc.addPage();
        y = 30;
        first = true;
      }
      line.split(" | ").forEach((cell, index) => {
        doc.text(cell, COLUMNS[index] ?? 20 + index * 90, y, {
          lineBreak: false,
        });
      });
      y += 14;
    }
    doc.end();
  });
}

const service = new SupplierInvoiceImportService();

function fails(code: string) {
  return (error: unknown) =>
    error instanceof SupplierInvoiceImportError && error.code === code;
}

describe("SupplierInvoiceImportService", () => {
  it("reads a real PDF end to end through the Hertlein adapter", async () => {
    const result = await service.read(await tablePdf(HERTLEIN_PDF_LINES));
    assert.equal(result.format, "PDF");
    assert.equal(result.invoiceNumber, "990002");
    assert.deepEqual(
      result.lines.map((line) => line.supplierSku),
      [
        "81593",
        "fm15025",
        "e3591100",
        "ELVOO 1000",
        "MRROSSM",
        "36273000",
        "z1",
      ],
    );
    assert.equal(
      result.lines[1]!.description,
      "Fauna Marin ELEMENTALS Trace Mn - Mangan - 250 ml",
    );
    // the PDF warning, and no arithmetic warning: the synthetic invoice adds up
    assert.deepEqual(result.warnings, [
      "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
    ]);
  });

  it("says so when no adapter knows the PDF", async () => {
    const other = HERTLEIN_PDF_LINES.map((line) =>
      line.replaceAll("Hertlein", "Masik"),
    );
    await assert.rejects(
      service.read(await tablePdf(other)),
      fails("PDF_LAYOUT_UNKNOWN"),
    );
  });

  it("decides the format by content, not by name", async () => {
    await assert.rejects(service.read(new Uint8Array()), fails("FILE_EMPTY"));
    await assert.rejects(
      service.read(Buffer.from("hello, ez nem szamla")),
      fails("FILE_UNSUPPORTED"),
    );
    await assert.rejects(
      service.read(Buffer.from("%PDF-1.4 csonka")),
      fails("PDF_INVALID"),
    );
    await assert.rejects(
      service.read(Buffer.from("<a>nem cii</a>")),
      fails("XML_NOT_CII"),
    );
  });

  it("warns when the lines do not add up to the invoice total", async () => {
    const off = HERTLEIN_PDF_LINES.map((line) =>
      line === "Summe in €: | 1.309,49" ? "Summe in €: | 1.400,00" : line,
    );
    const result = await service.read(await tablePdf(off));
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("eltér a számla nettó végösszegétől"),
      ),
      JSON.stringify(result.warnings),
    );
  });
});
