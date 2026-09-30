import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  adapterSenders,
  arrivalIdentity,
  documentContent,
  placeDocument,
  type PlacedDocument,
} from "./expected-arrival.intake.js";

const result = (extra: Partial<Parameters<typeof arrivalIdentity>[0]> = {}) =>
  ({
    format: "PDF",
    supplier: { name: "AQUARIOOM", vatId: "FR 12 345678901", country: "FR" },
    invoiceNumber: "FA00009139",
    invoiceDate: "2026-09-30",
    dueDate: null,
    currency: "EUR",
    netTotal: 100,
    lines: [],
    warnings: [],
    ...extra,
  }) as SupplierInvoiceImportResult & Parameters<typeof arrivalIdentity>[0];

function doc(
  extra: Partial<PlacedDocument> & { at?: number } = {},
): PlacedDocument {
  const { at = 0, ...rest } = extra;
  return {
    sha256: "s",
    kind: "INVOICE",
    invoiceNumber: "32600434",
    content: "c",
    receivedAt: new Date(Date.UTC(2026, 5, 18, 12, at)),
    ...rest,
  };
}

// What must fail: a proforma and its invoice landing on two arrivals; a
// proforma without an order number opening one keyed by its own number (it
// is not the invoice's); the same supplier split by the VAT id's spelling; a
// reminder's re-attached invoice read as new.
describe("what an arrived document opens or joins", () => {
  it("a proforma and its invoice share the order's arrival", () => {
    const proforma = arrivalIdentity(
      result({
        documentKind: "PROFORMA",
        orderReference: "13858",
        invoiceNumber: "CM9201",
      }),
    );
    const invoice = arrivalIdentity(
      result({ documentKind: "INVOICE", orderReference: " 13858 " }),
    );
    assert.equal(proforma?.arrivalKey, "order:13858");
    assert.equal(invoice?.arrivalKey, "order:13858");
    assert.equal(proforma?.supplierKey, "FR12345678901");
    assert.equal(proforma?.invoiceNumber, null);
    assert.equal(invoice?.invoiceNumber, "FA00009139");
  });

  it("without an order number an invoice is keyed by its number, and a proforma opens nothing", () => {
    assert.equal(arrivalIdentity(result())?.arrivalKey, "invoice:FA00009139");
    assert.equal(
      arrivalIdentity(
        result({ documentKind: "PROFORMA", invoiceNumber: "CM9201" }),
      ),
      null,
    );
  });

  it("the supplier's key is the VAT id however written, or the name without one", () => {
    const spaced = arrivalIdentity(
      result({
        supplier: { name: "X", vatId: "fr-12 345678901", country: "FR" },
      }),
    );
    assert.equal(spaced?.supplierKey, "FR12345678901");
    const named = arrivalIdentity(
      result({ supplier: { name: " Aquarioom ", vatId: null, country: null } }),
    );
    assert.equal(named?.supplierKey, "aquarioom");
    assert.equal(named?.supplierName, "Aquarioom");
    assert.equal(
      arrivalIdentity(
        result({ supplier: { name: "", vatId: null, country: null } }),
      ),
      null,
    );
  });

  it("the same bytes, or the same kind, number and content, is a duplicate", () => {
    const on = [doc({ sha256: "a", invoiceNumber: "FA1", content: "c1" })];
    // the same bytes, whatever they say
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "a", kind: "PROFORMA", invoiceNumber: null }),
        on,
        true,
      ),
      { status: "DUPLICATE" },
    );
    // a reminder: new bytes, same invoice, same content
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "b", invoiceNumber: "FA1", content: "c1", at: 9 }),
        on,
        true,
      ),
      { status: "DUPLICATE" },
    );
    // the invoice after its proforma is new
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "b", invoiceNumber: "FA1" }),
        [doc({ sha256: "p", kind: "PROFORMA", invoiceNumber: null })],
        true,
      ),
      { status: "READ", supersedes: [] },
    );
    // a proforma and an invoice may carry the same number: only the same kind counts
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "b", invoiceNumber: "13858", content: "x" }),
        [doc({ sha256: "p", kind: "PROFORMA", invoiceNumber: "13858" })],
        true,
      ),
      { status: "READ", supersedes: [] },
    );
    // no number: nothing to compare by
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "b", invoiceNumber: null, content: "c1" }),
        [doc({ sha256: "c", invoiceNumber: null, content: "c1" })],
        true,
      ),
      { status: "READ", supersedes: [] },
    );
  });

  /*
    THE CORRECTED INVOICE (acrobot's decision, 2026-09-30 10:42; Marine
    Aquatics 32600434, the "UPDATED INVOICE" 15 minutes after the original,
    one more line). What must fail: the correction dropped as a duplicate (the
    rule before); the original, read AFTER its correction (the mailbox lists
    the newest mail first), replacing it; a reminder of the original after the
    correction replacing it; a booked arrival changed.
  */
  it("a later mail with the same number and other content replaces the earlier version", () => {
    const original = doc({ sha256: "o", content: "180", at: 1 });
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "u", content: "254", at: 2 }),
        [doc({ sha256: "p", kind: "PROFORMA", invoiceNumber: null }), original],
        true,
      ),
      { status: "READ", supersedes: [1] },
    );
  });

  it("the original read after its correction is the replaced one, not the replacing one", () => {
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "o", content: "180", at: 1 }),
        [doc({ sha256: "u", content: "254", at: 2 })],
        true,
      ),
      { status: "SUPERSEDED" },
    );
  });

  it("a reminder of the original after the correction is a copy of a kept version", () => {
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "o2", content: "180", at: 3 }),
        [
          doc({ sha256: "o", content: "180", at: 1 }),
          doc({ sha256: "u", content: "254", at: 2 }),
        ],
        true,
      ),
      { status: "DUPLICATE" },
    );
  });

  it("on a booked arrival a different version replaces nothing; a copy of it is a copy", () => {
    const booked = [doc({ sha256: "o", content: "180", at: 1 })];
    assert.deepEqual(
      placeDocument(doc({ sha256: "u", content: "254", at: 2 }), booked, false),
      { status: "LATE_CORRECTION" },
    );
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "u2", content: "254", at: 3 }),
        [...booked, doc({ sha256: "u", content: "254", at: 2 })],
        false,
      ),
      { status: "DUPLICATE" },
    );
    // anything else on a booked arrival stays a duplicate, as before
    assert.deepEqual(
      placeDocument(
        doc({ sha256: "x", invoiceNumber: "OTHER", content: "9", at: 4 }),
        booked,
        false,
      ),
      { status: "DUPLICATE" },
    );
  });

  it("the content is what the invoice says, not the file: a reading with one more line differs", () => {
    const base = result({
      lines: [
        {
          lineNumber: 1,
          supplierSku: "BLUELIFE-225",
          ean: null,
          description: "Flatworm RX (30ml)",
          quantity: 3,
          unit: "db",
          unitNet: 20.9,
          discountPercent: null,
          lineNet: 62.7,
          isCharge: false,
        },
      ],
    });
    assert.equal(
      documentContent(base),
      documentContent({ ...base, warnings: ["más figyelmeztetés"] }),
    );
    assert.notEqual(
      documentContent(base),
      documentContent({
        ...base,
        // the header alone would not tell them apart: the lines must
        lines: [
          ...base.lines,
          { ...base.lines[0]!, lineNumber: 2, supplierSku: "MJ-L230R" },
        ],
      }),
    );
    assert.equal(documentContent(null), "");
  });

  it("reads the adapters' senders, and none from an adapter that names none", () => {
    assert.deepEqual(
      adapterSenders([{ senders: ["contact@aquarioom.com"] }, {}]),
      ["contact@aquarioom.com"],
    );
  });
});
