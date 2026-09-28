import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import { HERTLEIN_PDF_LINES } from "../../../testing/hertlein-invoice-pdf-lines.fixture.js";
import { hertleinPdfAdapter } from "./hertlein.pdf-adapter.js";

describe("hertleinPdfAdapter", () => {
  it("recognises only a Hertlein invoice", () => {
    assert.equal(hertleinPdfAdapter.matches(HERTLEIN_PDF_LINES), true);
    assert.equal(
      hertleinPdfAdapter.matches(
        HERTLEIN_PDF_LINES.map((line) => line.replaceAll("Hertlein", "Masik")),
      ),
      false,
    );
  });

  it("reads the header: number, dates, total, and the SELLER's tax id, not the buyer's", () => {
    const result = hertleinPdfAdapter.parse(HERTLEIN_PDF_LINES);
    assert.equal(result.format, "PDF");
    assert.equal(result.invoiceNumber, "990002");
    assert.equal(result.invoiceDate, "2026-09-25");
    assert.equal(result.dueDate, "2026-10-02");
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 1309.49);
    assert.deepEqual(result.supplier, {
      name: "Hertlein Aquaristik e.Kfr.",
      vatId: "DE123456789",
      country: "DE",
    });
    assert.ok(!JSON.stringify(result).includes("HU99999999"));
    assert.ok(!JSON.stringify(result).includes("Kitalalt Vevo"));
    assert.equal(result.warnings.length, 1);
  });

  it("reads every line across the page break, with the two measured hard cases", () => {
    const lines = hertleinPdfAdapter.parse(HERTLEIN_PDF_LINES).lines;
    assert.deepEqual(
      lines.map((line) => [line.supplierSku, line.description]),
      [
        ["81593", "Dupla Marin Coral Plugs 10 St., SB"],
        // the wrapped second line belongs to the item above it
        ["fm15025", "Fauna Marin ELEMENTALS Trace Mn - Mangan - 250 ml"],
        ["e3591100", "Eheim rapidCleaner 58 cm"],
        // the code with a space came joined with the text
        ["ELVOO 1000", "Easy-Life Voogle 1000 ml"],
        // an all-caps brand stays in the text, only the code is split off
        ["MRROSSM", "ARKA myReef Rocks 9-12 cm, 20 kg"],
        ["36273000", "Jebao EP-5.000 Förderpumpe inkl. Controller"],
        ["z1", "Frachtkosten (anteilig)"],
      ],
    );
    const discounted = lines[2]!;
    assert.equal(discounted.unitNet, 9.2);
    assert.equal(discounted.discountPercent, 10);
    assert.equal(discounted.lineNet, 24.84);
    assert.equal(lines[5]!.unitNet, 1070.25);
    assert.equal(lines[6]!.isCharge, true);
    assert.deepEqual(
      lines.map((line) => line.lineNumber),
      [1, 2, 3, 4, 5, 6, 7],
    );
  });

  it("keeps an item line whose code is lower case and joined to its text", () => {
    // measured on two 2022-2023 invoices: "fm14265ICP Fauna Marin ..." came as
    // ONE text item; the first reader dropped the line and the invoice was
    // 188.00 EUR short, silently
    const withJoined = HERTLEIN_PDF_LINES.map((line) =>
      line.startsWith("81593 |")
        ? "fm14265ICP Fauna Marin Professional Sea Salt 20 kg | 3,00 | 4,50 | 13,50"
        : line,
    );
    const lines = hertleinPdfAdapter.parse(withJoined).lines;
    assert.equal(lines.length, 7);
    assert.equal(lines[0]!.supplierSku, "fm14265ICP");
    assert.equal(
      lines[0]!.description,
      "Fauna Marin Professional Sea Salt 20 kg",
    );
  });

  it("never drops an item line: an unsplittable one stays, without a code, with a warning", () => {
    const withOdd = HERTLEIN_PDF_LINES.map((line) =>
      line.startsWith("81593 |")
        ? "Sonderposten ohne Nummer | 3,00 | 4,50 | 13,50"
        : line,
    );
    const result = hertleinPdfAdapter.parse(withOdd);
    assert.equal(result.lines.length, 7);
    assert.equal(result.lines[0]!.supplierSku, null);
    assert.equal(result.lines[0]!.lineNet, 13.5);
    assert.ok(
      result.warnings.some((warning) =>
        warning.startsWith("1. sor: a cikkszám"),
      ),
    );
  });

  it("refuses a credit note", () => {
    assert.throws(
      () =>
        hertleinPdfAdapter.parse([
          "Hertlein Aquaristik e.Kfr.",
          "Gutschrift",
          ...HERTLEIN_PDF_LINES,
        ]),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "CREDIT_NOTE",
    );
  });
});
