import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AQUARIOOM_PDF_LINES } from "../../../testing/aquarioom-invoice-pdf-lines.fixture.js";
import { DEJONG_PDF_LINES } from "../../../testing/dejong-invoice-pdf-lines.fixture.js";
import { HERTLEIN_PDF_LINES } from "../../../testing/hertlein-invoice-pdf-lines.fixture.js";
import { MARINE_AQUATICS_PDF_LINES } from "../../../testing/marine-aquatics-invoice-pdf-lines.fixture.js";
import { MENZEL_PDF_LINES } from "../../../testing/menzel-invoice-pdf-lines.fixture.js";
import { plausibilityWarnings } from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import { SUPPLIER_PDF_ADAPTERS } from "../supplier-pdf-adapter.js";
import { menzelPdfAdapter } from "./menzel.pdf-adapter.js";

describe("menzelPdfAdapter", () => {
  it("recognises only a Menzel invoice, and no other adapter takes it", () => {
    assert.equal(menzelPdfAdapter.matches(MENZEL_PDF_LINES), true);
    for (const other of [
      AQUARIOOM_PDF_LINES,
      DEJONG_PDF_LINES,
      HERTLEIN_PDF_LINES,
      MARINE_AQUATICS_PDF_LINES,
    ])
      assert.equal(menzelPdfAdapter.matches(other), false);
    assert.deepEqual(
      SUPPLIER_PDF_ADAPTERS.filter((a) => a.matches(MENZEL_PDF_LINES)).map(
        (a) => a.key,
      ),
      ["menzel"],
    );
  });

  /*
    The table header is what the seller's invoicing software prints; another
    German shop on the same software would print it too, and would then be
    read with MENZEL's VAT id. The creditor id is Menzel's own.
    WHAT TURNS IT RED: recognition on the table header alone.
  */
  it("the same table without Menzel's creditor id is not Menzel", () => {
    const other = MENZEL_PDF_LINES.map((line) =>
      line.replace("DE60ZZZ00002702958", "DE11ZZZ00000000000"),
    );
    assert.equal(menzelPdfAdapter.matches(other), false);
  });

  it("reads the header, and the SELLER's VAT id, not ours", () => {
    const result = menzelPdfAdapter.parse(MENZEL_PDF_LINES);
    assert.equal(result.invoiceNumber, "20260404");
    assert.equal(result.invoiceDate, "2026-05-15");
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 612.49);
    assert.deepEqual(result.supplier, {
      name: "MCM Menzel",
      vatId: "DE366930447",
      country: "DE",
    });
    assert.ok(!JSON.stringify(result.supplier).includes("HU99999999"));
    // "zum Auftrag:" holds free text on the one invoice there is: not read
    assert.equal(result.orderReference, null);
    assert.equal(result.documentKind, "INVOICE");
  });

  it("reads each row once, with the measured hard cases", () => {
    const lines = menzelPdfAdapter.parse(MENZEL_PDF_LINES).lines;
    assert.deepEqual(
      lines.map((line) => [
        line.supplierSku,
        line.description,
        line.quantity,
        line.unitNet,
        line.lineNet,
      ]),
      [
        // with a discount cell: the price AFTER the discount
        ["104-0100", "Conomurex luhuanus", 4, 4.17, 16.68],
        // the name over two cells
        ["108-0211-3", "Pachycerianthus spec. med lila", 2, 18.7, 37.4],
        // the name breaks onto the next line
        [
          "007-0010-9",
          "Amblyeleotris aurora lg mit Symbiosegrundel",
          2,
          34.38,
          68.76,
        ],
        ["100-0070-2", "Lysmata amboinensis sm-med", 10, 9.73, 97.3],
        // no discount cell; the "(A)" note and the CITES line are not the name
        [
          "123-0012-1a3u",
          "Tridacna crocea 3-4cm -Ultra Grade- g",
          3,
          57.5,
          172.5,
        ],
        // "(A)" in its own cell before the VAT rate
        ["127-0040-4a", 'Menella spec. "lila" med-lg', 2, 59, 118],
        [
          "120-0001-a",
          "Cypastrea spp. AC Ableger aus DE- E00923/23",
          1,
          33.15,
          33.15,
        ],
        ["400-0001-1", "OCEAMO Lab Classic Meerwasseranalyse", 3, 22.9, 68.7],
      ],
    );
    assert.equal(
      lines.some((line) => /Cites|\(A\)|Übertrag/.test(line.description)),
      false,
    );
    assert.equal(
      lines.some((line) => line.isCharge),
      false,
    );
  });

  it("the rows add up to the net total, so the page shows no warning", () => {
    assert.deepEqual(
      plausibilityWarnings(menzelPdfAdapter.parse(MENZEL_PDF_LINES)),
      [],
    );
  });

  it("refuses a credit note rather than reading an unknown layout", () => {
    assert.throws(
      () =>
        menzelPdfAdapter.parse(
          MENZEL_PDF_LINES.map((line) =>
            line.startsWith("Rechnung |")
              ? "Gutschrift | DE60ZZZ00002702958"
              : line,
          ),
        ),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "CREDIT_NOTE",
    );
  });

  it("names its sender for the mailbox watcher", () => {
    assert.deepEqual(menzelPdfAdapter.senders, ["accounting@mcm-menzel.de"]);
  });
});
