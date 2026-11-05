import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RANGE_LIMIT,
  matchRemittance,
  moneyCents,
  refMatchesInvoiceNumber,
  remittanceInvoiceRefs,
} from "./remittance-invoice-refs.js";

/*
  WHAT TURNS THIS RED (card aeddb2c3, Balázs 2026-11-04 16:36 UTC). The real remittance "2026/00083,86,85,84" not read
  as four invoices; a range, a full second number or a prefix lost; a guessed number (a longer shortening, a backward
  or too long range, a following amount); a reference matched to the wrong series; a pairing offered when one invoice
  is missing, ambiguous, or the amount is off by a fillér.
*/
const numbers = (text: string) =>
  remittanceInvoiceRefs(text).map(
    (ref) =>
      `${ref.prefix ?? ""}${ref.prefix ? "-" : ""}${ref.year}/${ref.number}`,
  );

describe("the invoice numbers a remittance names", () => {
  it("Balázs's transfer: one base number and three shortened ones", () => {
    assert.deepEqual(numbers("2026/00083,86,85,84"), [
      "2026/00083",
      "2026/00086",
      "2026/00085",
      "2026/00084",
    ]);
  });

  it("separators, spaces, the prefix and a full second number", () => {
    assert.deepEqual(numbers("Szla: ACRW-2026/00083; 86 és 00090 + 1"), [
      "ACRW-2026/00083",
      "ACRW-2026/00086",
      "ACRW-2026/00090",
      "ACRW-2026/00081",
    ]);
    assert.deepEqual(numbers("acrw2026 / 00406"), ["ACRW-2026/00406"]);
    assert.deepEqual(numbers("ARCW-2025/00650 visszautalás"), [
      "ARCW-2025/00650",
    ]);
  });

  it("a range, within its limit only", () => {
    assert.deepEqual(numbers("2026/00083-86"), [
      "2026/00083",
      "2026/00084",
      "2026/00085",
      "2026/00086",
    ]);
    // backwards, or longer than the limit: the base only, nothing guessed
    assert.deepEqual(numbers("2026/00086-83"), ["2026/00086"]);
    assert.deepEqual(numbers(`2026/00001-${RANGE_LIMIT + 1}`), ["2026/00001"]);
  });

  it("two full references stay two, and an amount after one is not a number", () => {
    assert.deepEqual(numbers("ACRW-2026/00083, ACRW-2026/00086"), [
      "ACRW-2026/00083",
      "ACRW-2026/00086",
    ]);
    assert.deepEqual(numbers("2026/00083, 127000 Ft"), ["2026/00083"]);
    assert.deepEqual(numbers("rendelés 12345, nincs szám"), []);
    // another series' number is not ours, even with a bare one beside it
    assert.deepEqual(numbers("SZ-2026/00012 és D2026/00013, 2026/00083"), [
      "2026/00083",
    ]);
  });
});

describe("a reference against an invoice number", () => {
  it("without a prefix any series fits; with one, only that (ARCW is ACRW)", () => {
    const [bare] = remittanceInvoiceRefs("2026/00083");
    assert.equal(refMatchesInvoiceNumber(bare!, "ACRW-2026/00083"), true);
    assert.equal(refMatchesInvoiceNumber(bare!, "ACRB-2026/00083"), true);
    assert.equal(refMatchesInvoiceNumber(bare!, "ACRW-2025/00083"), false);
    const [typo] = remittanceInvoiceRefs("ARCW-2026/00083");
    assert.equal(refMatchesInvoiceNumber(typo!, "ACRW-2026/00083"), true);
    assert.equal(refMatchesInvoiceNumber(typo!, "ACRB-2026/00083"), false);
  });

  // Balázs's live run, 2026-11-05 11:05: every transfer naming the 2026/ series stood as "nincs"
  it("our series without a prefix: a bare reference fits it, a prefixed one does not", () => {
    const [bare] = remittanceInvoiceRefs("2026/00083");
    assert.equal(refMatchesInvoiceNumber(bare!, "2026/00083"), true);
    assert.equal(refMatchesInvoiceNumber(bare!, "2026/00084"), false);
    assert.equal(refMatchesInvoiceNumber(bare!, "2025/00083"), false);
    const [prefixed] = remittanceInvoiceRefs("ACRW-2026/00083");
    assert.equal(refMatchesInvoiceNumber(prefixed!, "2026/00083"), false);
  });

  it("the customer's extra zero is the same number: 2026/000436 is ACRW-2026/00436", () => {
    const [padded] = remittanceInvoiceRefs("2026/000436");
    assert.equal(refMatchesInvoiceNumber(padded!, "ACRW-2026/00436"), true);
    assert.equal(refMatchesInvoiceNumber(padded!, "ACRW-2026/01436"), false);
  });
});

describe("the transfer against the named invoices", () => {
  const invoices = [
    { invoiceNumber: "ACRW-2026/00083", open: "10000.00" },
    { invoiceNumber: "ACRW-2026/00084", open: "20000" },
    { invoiceNumber: "ACRW-2026/00085", open: "30000.5" },
    { invoiceNumber: "ACRW-2026/00086", open: "40000.00" },
  ];

  it("offers the four when the amount is their sum to the fillér", () => {
    const match = matchRemittance("2026/00083,86,85,84", "100000.50", invoices);
    assert.equal(match.kind, "EXACT");
    assert.deepEqual(
      match.kind === "EXACT" && match.invoices.map((i) => i.invoiceNumber),
      [
        "ACRW-2026/00083",
        "ACRW-2026/00086",
        "ACRW-2026/00085",
        "ACRW-2026/00084",
      ],
    );
  });

  it("a fillér off is a mismatch, with the difference", () => {
    const match = matchRemittance("2026/00083,86,85,84", "100000.49", invoices);
    assert.equal(match.kind, "AMOUNT_MISMATCH");
    assert.equal(
      match.kind === "AMOUNT_MISMATCH" && match.differenceCents,
      -1n,
    );
  });

  it("a missing or an ambiguous invoice is not offered", () => {
    assert.deepEqual(
      matchRemittance("2026/00083,87", "10000", invoices).kind,
      "UNRESOLVED",
    );
    const twoSeries = [
      ...invoices,
      { invoiceNumber: "ACRB-2026/00083", open: "10000" },
    ];
    const match = matchRemittance("2026/00083", "10000", twoSeries);
    assert.equal(match.kind, "UNRESOLVED");
    assert.equal(match.kind === "UNRESOLVED" && match.ambiguous.length, 1);
    assert.equal(
      matchRemittance("köszönöm", "10000", invoices).kind,
      "NO_REFERENCE",
    );
  });

  it("money is whole fillér, a sub-fillér value is not money", () => {
    assert.equal(moneyCents("100000.5"), 10000050n);
    assert.equal(moneyCents("-12.30"), -1230n);
    assert.equal(moneyCents("1.005"), null);
    assert.equal(moneyCents("1 000"), null);
  });
});
