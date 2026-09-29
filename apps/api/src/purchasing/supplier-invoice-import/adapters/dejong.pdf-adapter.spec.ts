import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateCandidates, indexCandidateMaster } from "@acropora/jev";

import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import { DEJONG_PDF_LINES } from "../../../testing/dejong-invoice-pdf-lines.fixture.js";
import { HERTLEIN_PDF_LINES } from "../../../testing/hertlein-invoice-pdf-lines.fixture.js";
import {
  deJongCandidateProfile,
  deJongPdfAdapter,
} from "./dejong.pdf-adapter.js";
import { hertleinPdfAdapter } from "./hertlein.pdf-adapter.js";

describe("deJongPdfAdapter", () => {
  it("recognises only a De Jong invoice, and Hertlein does not take it", () => {
    assert.equal(deJongPdfAdapter.matches(DEJONG_PDF_LINES), true);
    assert.equal(deJongPdfAdapter.matches(HERTLEIN_PDF_LINES), false);
    assert.equal(hertleinPdfAdapter.matches(DEJONG_PDF_LINES), false);
  });

  it("reads the header: number, dates, total, and the SELLER's tax id, not the buyer's", () => {
    const result = deJongPdfAdapter.parse(DEJONG_PDF_LINES);
    assert.equal(result.format, "PDF");
    assert.equal(result.invoiceNumber, "99008847");
    assert.equal(result.invoiceDate, "2026-09-23");
    assert.equal(result.dueDate, "2026-10-07");
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 16245.94);
    assert.deepEqual(result.supplier, {
      name: "De Jong Marinelife B.V.",
      vatId: "NL999999999B01",
      country: "NL",
    });
    assert.ok(!JSON.stringify(result).includes("HU99999999"));
    assert.equal(result.warnings.length, 1);
  });

  it("reads every line across the page break, with the measured hard cases", () => {
    const lines = deJongPdfAdapter.parse(DEJONG_PDF_LINES).lines;
    assert.deepEqual(
      lines.map((line) => [line.supplierSku, line.description]),
      [
        ["AI-PUCKPHD", "Prime HD Led Puck"],
        // the wrapped code tail joins the code; the split cell joins the text
        [
          "PHILIPS-2020-CONTROLLER",
          "Philips CoralCare - Controller EU/UK (new model)",
        ],
        ["FAUNA-14230", "Balling Light Calcium-Mix - 2 kg"],
        ["NS-WSK-EU", "WAV Starter Kit"],
        // the HS code cell is not the name
        [
          "DJM-075012-T-BIO-BOX",
          "Bio-based plastic bag XXS (12x30) - Box 1000 pcs.",
        ],
        ["AO-PAR-010152", "Ostorhinchus parvulus"],
        [null, "Rhina ancylostoma"],
        ["SC-090012", "Schenker 1/2 pallet"],
      ],
    );
    // the carried-over total opened no line, and the lines add up
    const sum = lines.reduce((total, line) => total + line.lineNet, 0);
    assert.equal(Math.round(sum * 100) / 100, 16245.94);
    assert.ok(!lines.some((line) => line.description.includes("Cites")));
  });

  it("reads the amounts: a joined discount, a surcharge, no discount", () => {
    const lines = deJongPdfAdapter.parse(DEJONG_PDF_LINES).lines;
    assert.deepEqual(
      [lines[3]!.quantity, lines[3]!.unitNet, lines[3]!.discountPercent],
      [2, 428.16, 10],
    );
    assert.equal(lines[3]!.lineNet, 770.69);
    assert.equal(lines[5]!.discountPercent, -5);
    assert.equal(lines[0]!.discountPercent, null);
    assert.equal(lines[6]!.unitNet, 15000);
  });

  it("marks the charge by its code, and nothing else", () => {
    const lines = deJongPdfAdapter.parse(DEJONG_PDF_LINES).lines;
    assert.deepEqual(
      lines.filter((line) => line.isCharge).map((line) => line.supplierSku),
      ["SC-090012"],
    );
  });

  it("marks De Jong's 09xxxx service codes as charges, by the code alone", () => {
    const at = DEJONG_PDF_LINES.indexOf(
      "1 | SC-090012 | Schenker 1/2 pallet | € | 60,00 | 0,00% | € | 60,00",
    );
    const lines = deJongPdfAdapter.parse([
      ...DEJONG_PDF_LINES.slice(0, at + 1),
      // real texts from the 98 invoices, none of which says "shipping"
      "1 | 090002 | Box charge | € | 12,50 | 0,00% | € | 12,50",
      "1 | 090010 | Cites charge | € | 35,00 | 0,00% | € | 35,00",
      ...DEJONG_PDF_LINES.slice(at + 1),
    ]).lines;
    assert.deepEqual(
      lines.filter((line) => line.isCharge).map((line) => line.supplierSku),
      ["SC-090012", "090002", "090010"],
    );
  });

  it("refuses a credit note", () => {
    assert.throws(
      () =>
        deJongPdfAdapter.parse(
          DEJONG_PDF_LINES.map((line) =>
            line === "Invoice" ? "Credit note" : line,
          ),
        ),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "CREDIT_NOTE",
    );
  });
});

describe("deJongCandidateProfile", () => {
  // the measured miss, inv26008847: "Lens for Hydra 32 HD" read "lens" as
  // the brand, and the right product was not among the candidates
  const master = indexCandidateMaster([
    { variantId: "v-lens", text: "Aqua Illumination Hydra 32 HD lencse 16" },
    { variantId: "v-cloth", text: "Lens tisztító kendő" },
    { variantId: "v-rs", text: "Red Sea NO3:PO4-X 1000 ml" },
  ]);

  it("takes the brand from the code prefix, not from the first word", () => {
    const result = generateCandidates(
      "Lens for Hydra 32 HD",
      "ai-lens16",
      master,
      deJongCandidateProfile,
    );
    assert.equal(result.brandSource, "routing");
    assert.deepEqual(result.candidates, ["v-lens"]);
  });

  it("reads RS as Red Sea, written in two words in our catalogue", () => {
    const result = generateCandidates(
      "NO3:PO4-X 1 litre",
      "rs-r22204",
      master,
      deJongCandidateProfile,
    );
    // found by the brand, not by the fallback that drops the brand
    assert.equal(result.fallback, false);
    assert.deepEqual(result.candidates, ["v-rs"]);
  });
});
