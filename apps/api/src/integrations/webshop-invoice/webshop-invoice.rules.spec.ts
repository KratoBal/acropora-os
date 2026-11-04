import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  guestInvoicesOf,
  type InvoiceCandidate,
} from "./webshop-invoice.rules.js";

/**
 * MELYIK SZÁMLÁKAT LÁTJA A VENDÉG. MI PIROSÍT: ha a díjbekérő, a szállítólevél, a sztornó, a helyesbítő, egy bejövő vagy egy
 * PDF nélküli sor számlaként átmegy; ha a sztornózott számla letölthető marad; ha a sorrend nem a kiállítás ideje.
 */
const row = (
  over: Partial<InvoiceCandidate> & { id: string },
): InvoiceCandidate => ({
  direction: "OUTBOUND",
  status: "ISSUED",
  documentType: "INVOICE",
  pdfStorageKey: "invoice/x/billing-document.pdf",
  invoiceNumber: `SZ-${over.id}`,
  issueDate: new Date("2026-11-01T10:00:00.000Z"),
  ...over,
});

describe("guestInvoicesOf", () => {
  it("lets through the issued outgoing invoice, advance invoice and final invoice with a PDF", () => {
    const out = guestInvoicesOf(
      [
        row({ id: "a", documentType: "INVOICE" }),
        row({ id: "b", documentType: "ADVANCE_INVOICE" }),
        row({ id: "c", documentType: "FINAL_INVOICE" }),
      ],
      new Set(),
    );
    assert.deepEqual(
      out.map((i) => i.id),
      ["a", "b", "c"],
    );
    assert.equal(out[0]!.issueDate, "2026-11-01T10:00:00.000Z");
  });

  it("drops what is not an invoice for the customer, one reason at a time", () => {
    const cases: Array<Partial<InvoiceCandidate>> = [
      { documentType: "PROFORMA" },
      { documentType: "DELIVERY_NOTE" },
      { documentType: "STORNO" },
      { documentType: "CORRECTION" },
      { direction: "INBOUND" },
      { status: "DRAFT" },
      { status: "ISSUING" },
      { pdfStorageKey: null },
    ];
    for (const over of cases)
      assert.deepEqual(
        guestInvoicesOf([row({ id: "x", ...over })], new Set()),
        [],
        JSON.stringify(over),
      );
  });

  it("drops a stornoed invoice, keeps the others", () => {
    const out = guestInvoicesOf(
      [row({ id: "a" }), row({ id: "b" })],
      new Set(["a"]),
    );
    assert.deepEqual(
      out.map((i) => i.id),
      ["b"],
    );
  });

  it("orders by issue date, the oldest first, then by id", () => {
    const out = guestInvoicesOf(
      [
        row({ id: "late", issueDate: new Date("2026-11-03T00:00:00.000Z") }),
        row({ id: "b", issueDate: new Date("2026-11-01T00:00:00.000Z") }),
        row({ id: "a", issueDate: new Date("2026-11-01T00:00:00.000Z") }),
      ],
      new Set(),
    );
    assert.deepEqual(
      out.map((i) => i.id),
      ["a", "b", "late"],
    );
  });
});
