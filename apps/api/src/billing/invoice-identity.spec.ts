import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readInvoiceText } from "../missing-invoices/collection/invoice-text.js";
import { invoiceIdentityKey } from "./invoice-identity.js";

// Balázs, 2026-11-18: two OpenAI invoices (20D3D94E-0001, -0002) uploaded to two transactions were called duplicates because the
// upload's reader gave both the bare prefix as the number. The identity is the number plus the supplier, so the two must differ
// from the READING on, not only in the key function.
describe("the identity of two invoices of one Stripe customer", () => {
  const reading = (serial: string, fileName: string) =>
    readInvoiceText(
      [
        "OpenAI, LLC | @openai | Bill to | Ship to",
        `Invoice number | 20D3D94E | \u0000 | ${serial}`,
      ],
      { fileName },
    ).invoiceNumber!;

  it("differs between -0001 and -0002 and is stable for the same invoice", () => {
    const first = invoiceIdentityKey(
      reading("0001", "Invoice-20D3D94E-0001.pdf"),
      null,
      "OpenAI, LLC",
    );
    const second = invoiceIdentityKey(
      reading("0002", "Invoice-20D3D94E-0002.pdf"),
      null,
      "OpenAI, LLC",
    );
    assert.equal(first, "20d3d94e-0001|openai, llc");
    assert.notEqual(first, second);
    assert.equal(
      invoiceIdentityKey(reading("0001", "Invoice.pdf"), null, "OpenAI, LLC"),
      first,
      "the same invoice uploaded under another file name keeps its identity",
    );
  });
});
