import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AQUARIOOM_PDF_LINES } from "../../../testing/aquarioom-invoice-pdf-lines.fixture.js";
import { DEJONG_PDF_LINES } from "../../../testing/dejong-invoice-pdf-lines.fixture.js";
import { HERTLEIN_PDF_LINES } from "../../../testing/hertlein-invoice-pdf-lines.fixture.js";
import {
  MARINE_AQUATICS_ACCOUNT_INVOICE_LINES,
  MARINE_AQUATICS_PDF_LINES,
  MARINE_AQUATICS_PROFORMA_LINES,
  MARINE_AQUATICS_SHIPPING_INVOICE_LINES,
} from "../../../testing/marine-aquatics-invoice-pdf-lines.fixture.js";
import { plausibilityWarnings } from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import { SUPPLIER_PDF_ADAPTERS } from "../supplier-pdf-adapter.js";
import { marineAquaticsPdfAdapter } from "./marine-aquatics.pdf-adapter.js";

const summary = (lines: readonly string[]) =>
  marineAquaticsPdfAdapter
    .parse(lines, { allowProforma: true })
    .lines.map((line) => [
      line.supplierSku,
      line.description,
      line.quantity,
      line.unit,
      line.unitNet,
      line.lineNet,
      line.isCharge,
    ]);

describe("marineAquaticsPdfAdapter", () => {
  it("recognises only a Marine Aquatics document, and no other adapter takes it", () => {
    for (const lines of [
      MARINE_AQUATICS_PDF_LINES,
      MARINE_AQUATICS_ACCOUNT_INVOICE_LINES,
      MARINE_AQUATICS_SHIPPING_INVOICE_LINES,
      MARINE_AQUATICS_PROFORMA_LINES,
    ])
      assert.deepEqual(
        SUPPLIER_PDF_ADAPTERS.filter((a) => a.matches(lines)).map((a) => a.key),
        ["marine-aquatics"],
      );
    for (const other of [
      AQUARIOOM_PDF_LINES,
      DEJONG_PDF_LINES,
      HERTLEIN_PDF_LINES,
    ])
      assert.equal(marineAquaticsPdfAdapter.matches(other), false);
  });

  it("reads the header: number, order, dates, currency, total, and the SELLER's tax id, not ours", () => {
    const result = marineAquaticsPdfAdapter.parse(MARINE_AQUATICS_PDF_LINES);
    assert.equal(result.invoiceNumber, "32699001");
    assert.equal(result.orderReference, "19001");
    assert.equal(result.invoiceDate, "2026-09-01");
    assert.equal(result.dueDate, "2026-09-04");
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 1308);
    assert.equal(result.documentKind, "INVOICE");
    assert.deepEqual(result.supplier, {
      name: "Marine Aquatics s.r.o.",
      vatId: "CZ02622386",
      country: "CZ",
    });
    assert.ok(!JSON.stringify(result).includes("HU99999999"));
  });

  it("reads each row once, past the dotted rules, with the rounding as a charge", () => {
    assert.deepEqual(summary(MARINE_AQUATICS_PDF_LINES), [
      // the unit is read: kg stays kg
      [
        "MR-CUT1",
        "MarcoRock CUT natural rock (1kg)",
        20,
        "kg",
        9.2,
        184,
        false,
      ],
      [
        "POLYPLAB-MEDIC",
        "PolypLab Medic Treatment (30ml)",
        3,
        "db",
        26.3,
        78.9,
        false,
      ],
      // a code with spaces is still one cell
      ["AF Poly Glue 250", "AF Poly Glue (250ml)", 3, "db", 7.4, 22.2, false],
      // a space groups the thousands
      [
        "MJ-L130R",
        "Maxspect Jump LED - 32-LEDs aq. lighting (30W)",
        12,
        "db",
        83.5,
        1002,
        false,
      ],
      // shipping: no code, no unit
      [
        null,
        "DPD - ZONE I (Export) trans - HUNGARY",
        1,
        "db",
        21.1,
        21.1,
        true,
      ],
      // the total is rounded to a whole euro: 1 308,20 of rows, 1 308,00 total
      [null, "Kerekítés", 1, "db", -0.2, -0.2, true],
    ]);
    assert.deepEqual(
      plausibilityWarnings(
        marineAquaticsPdfAdapter.parse(MARINE_AQUATICS_PDF_LINES),
      ),
      [],
    );
  });

  it("an account invoice skips the prepayment row; its total is the goods', not the 0,00 due", () => {
    const result = marineAquaticsPdfAdapter.parse(
      MARINE_AQUATICS_ACCOUNT_INVOICE_LINES,
    );
    assert.equal(result.netTotal, 359.4);
    assert.equal(result.orderReference, "19002");
    assert.equal(result.currency, "EUR");
    assert.deepEqual(summary(MARINE_AQUATICS_ACCOUNT_INVOICE_LINES), [
      [
        "AI-NERO5",
        "AI Nero 5 - powerhead (~11300l/h /~30W)",
        2,
        "db",
        179.7,
        359.4,
        false,
      ],
    ]);
    assert.deepEqual(plausibilityWarnings(result), []);
  });

  it("a shipping invoice has no order number; a coded row without a unit is a charge", () => {
    const result = marineAquaticsPdfAdapter.parse(
      MARINE_AQUATICS_SHIPPING_INVOICE_LINES,
    );
    assert.equal(result.orderReference, null);
    assert.equal(result.invoiceNumber, "32699003");
    assert.deepEqual(summary(MARINE_AQUATICS_SHIPPING_INVOICE_LINES), [
      [
        "DPD HU18",
        "DPD transportation up to 18kg - HUNGARY",
        1,
        "db",
        9.9,
        9.9,
        true,
      ],
      [null, "RABEN pallet shipping", 1, "db", 92, 92, true],
      [null, "Kerekítés", 1, "db", 0.1, 0.1, true],
    ]);
  });

  it("a difference of a euro or more is not rounding: no line, the warning stays", () => {
    const lines = MARINE_AQUATICS_PDF_LINES.map((line) =>
      line.startsWith("TOTAL | ")
        ? "TOTAL | 1 310,00 | 0,00 | 1 310,00 | Total due: | 1 310,00"
        : line,
    );
    const result = marineAquaticsPdfAdapter.parse(lines);
    assert.equal(
      result.lines.some((line) => line.description === "Kerekítés"),
      false,
    );
    assert.equal(plausibilityWarnings(result).length, 1);
  });

  it("refuses a proforma by default: it is not an invoice to receive", () => {
    assert.throws(
      () => marineAquaticsPdfAdapter.parse(MARINE_AQUATICS_PROFORMA_LINES),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "PROFORMA",
    );
  });

  it("reads a proforma when asked, as one, with the order number its invoice carries", () => {
    const result = marineAquaticsPdfAdapter.parse(
      MARINE_AQUATICS_PROFORMA_LINES,
      { allowProforma: true },
    );
    assert.equal(result.documentKind, "PROFORMA");
    assert.equal(result.invoiceNumber, "52699001");
    assert.equal(
      result.orderReference,
      marineAquaticsPdfAdapter.parse(MARINE_AQUATICS_ACCOUNT_INVOICE_LINES)
        .orderReference,
    );
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 550);
    assert.deepEqual(
      result.lines.map((line) => line.supplierSku),
      ["AI-NERO5", null, null],
    );
    assert.deepEqual(plausibilityWarnings(result), []);
  });

  it("names its sender for the mailbox watcher", () => {
    assert.deepEqual(marineAquaticsPdfAdapter.senders, [
      "r.macek@marine-aquatics.eu",
    ]);
  });

  it("a document without rows is refused", () => {
    assert.throws(
      () =>
        marineAquaticsPdfAdapter.parse(
          MARINE_AQUATICS_PDF_LINES.filter(
            (line) =>
              !line.includes(" | pcs | ") &&
              !line.includes(" | kg | ") &&
              !line.startsWith("DPD"),
          ),
        ),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "NO_LINES",
    );
  });
});
