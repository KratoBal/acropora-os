import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCandidates, indexCandidateMaster } from "@acropora/jev";

import {
  AQUARIOOM_PDF_LINES,
  AQUARIOOM_PROFORMA_LINES,
} from "../../../testing/aquarioom-invoice-pdf-lines.fixture.js";
import { DEJONG_PDF_LINES } from "../../../testing/dejong-invoice-pdf-lines.fixture.js";
import { HERTLEIN_PDF_LINES } from "../../../testing/hertlein-invoice-pdf-lines.fixture.js";
import { plausibilityWarnings } from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import { SUPPLIER_PDF_ADAPTERS } from "../supplier-pdf-adapter.js";
import {
  aquarioomCandidateProfile,
  aquarioomPdfAdapter,
} from "./aquarioom.pdf-adapter.js";

describe("aquarioomPdfAdapter", () => {
  it("recognises only an Aquarioom document, and no other adapter takes it", () => {
    assert.equal(aquarioomPdfAdapter.matches(AQUARIOOM_PDF_LINES), true);
    assert.equal(aquarioomPdfAdapter.matches(DEJONG_PDF_LINES), false);
    assert.equal(aquarioomPdfAdapter.matches(HERTLEIN_PDF_LINES), false);
    assert.deepEqual(
      SUPPLIER_PDF_ADAPTERS.filter((a) => a.matches(AQUARIOOM_PDF_LINES)).map(
        (a) => a.key,
      ),
      ["aquarioom"],
    );
  });

  it("reads the header: number, date, total, order, and the SELLER's tax id, not ours", () => {
    const result = aquarioomPdfAdapter.parse(AQUARIOOM_PDF_LINES);
    assert.equal(result.invoiceNumber, "FA00001234");
    assert.equal(result.invoiceDate, "2026-09-30");
    assert.equal(result.currency, "EUR");
    // "Total HT Net", not the 0,00 "Grand Total" after the prepayment
    assert.equal(result.netTotal, 1170);
    assert.equal(result.orderReference, "12345");
    assert.equal(result.documentKind, "INVOICE");
    assert.deepEqual(result.supplier, {
      name: "Aquarioom",
      vatId: "FR67529301244",
      country: "FR",
    });
    assert.ok(!JSON.stringify(result.supplier).includes("HU99999999"));
  });

  it("reads each line once, with the measured hard cases", () => {
    const lines = aquarioomPdfAdapter.parse(AQUARIOOM_PDF_LINES).lines;
    assert.deepEqual(
      lines.map((line) => [
        line.supplierSku,
        line.description,
        line.quantity,
        line.unitNet,
      ]),
      [
        ["A-FBN4", '4" Nylon Filter Bag', 5, 2],
        // the code broke after its dash
        ["AA-SATO270D", "Smart ATO NANO G2", 2, 50],
        // the description broke onto the next line
        [
          "F-EDSP",
          "Flipper Edge Standard 2 in 1 Magnetic Cleaner with 2 blade Puffer Limited Edition",
          1,
          40,
        ],
        // a space groups the thousands
        ["M-RSX200", "Maxspect RSX 200W", 1, 1000],
        // the free replacement part is received goods; its two notes are not
        ["M-GP3016CE", "Maxspect Gyre 350 Cloud Edition - Motor", 1, 0],
        // the carriage from the totals, as a charge line
        [null, "Carriage", 1, 20],
      ],
    );
    assert.deepEqual(
      lines.map((line) => line.isCharge),
      [false, false, false, false, false, true],
    );
  });

  it("the lines add up to the net total, so the page shows no warning", () => {
    assert.deepEqual(
      plausibilityWarnings(aquarioomPdfAdapter.parse(AQUARIOOM_PDF_LINES)),
      [],
    );
  });

  it("without carriage, takes the FIRST Grand Total, not the 0,00 after the prepayment", () => {
    // the shape of FA00008880: no "Total HT Net" row, the total stands in the
    // VAT-exemption row, and after "Acomptes" a second "Grand Total | 0,00 €"
    const lines = AQUARIOOM_PDF_LINES.filter(
      (line) =>
        !line.startsWith("Carriage |") &&
        !line.includes("Total HT Net") &&
        line !== "Grand Total | 1 170,00 €",
    )
      .map((line) =>
        line === "VAT | 0,00 €"
          ? "VAT | 0,00 €\nVAT exemption: article 262 ter I of the French General Tax Code | Grand Total | 1 150,00 €"
          : line === "Acomptes | 1 170,00 €"
            ? "Acomptes | 1 150,00 €"
            : line,
      )
      .flatMap((line) => line.split("\n"));
    const result = aquarioomPdfAdapter.parse(lines);
    assert.equal(result.netTotal, 1150);
    assert.equal(
      result.lines.some((line) => line.description === "Carriage"),
      false,
    );
    assert.deepEqual(plausibilityWarnings(result), []);
  });

  it("refuses a proforma by default: it is not an invoice to receive", () => {
    assert.throws(
      () => aquarioomPdfAdapter.parse(AQUARIOOM_PROFORMA_LINES),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "PROFORMA",
    );
  });

  it("reads a proforma when asked, as one, with its order number and total", () => {
    const result = aquarioomPdfAdapter.parse(AQUARIOOM_PROFORMA_LINES, {
      allowProforma: true,
    });
    assert.equal(result.documentKind, "PROFORMA");
    assert.equal(result.invoiceNumber, "CM1234");
    assert.equal(result.orderReference, "12346");
    // no carriage and no "Total HT Net": the first "Grand Total"
    assert.equal(result.netTotal, 300);
    assert.deepEqual(
      result.lines.map((line) => line.supplierSku),
      ["AS-FX104"],
    );
    assert.deepEqual(plausibilityWarnings(result), []);
  });

  it("names its sender for the mailbox watcher", () => {
    assert.deepEqual(aquarioomPdfAdapter.senders, ["contact@aquarioom.com"]);
  });
});

describe("aquarioomCandidateProfile", () => {
  const master = indexCandidateMaster([
    { variantId: "v-stir", text: "AutoAqua Smart Stir keverő" },
    { variantId: "v-other-stir", text: "Smart Stir mágneses keverőpálca" },
    {
      variantId: "v-roller",
      text: "Tropic Creations Roller Clean 100 automata papírszűrő",
    },
  ]);

  it("takes the brand from the code prefix, not from the first word", () => {
    const result = generateCandidates(
      "Smart Stir",
      "aa-ss100",
      master,
      aquarioomCandidateProfile,
    );
    assert.equal(result.brandSource, "routing");
    assert.deepEqual(result.candidates, ["v-stir"]);
  });

  it("reads TC as Tropic Creations, the name our catalogue uses for Roller Clean", () => {
    const result = generateCandidates(
      "Roller Clean 100 Glamorca",
      "tc-rc100",
      master,
      aquarioomCandidateProfile,
    );
    assert.equal(result.fallback, false);
    assert.deepEqual(result.candidates, ["v-roller"]);
  });
});
