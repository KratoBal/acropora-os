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

/*
  THE CUSTOMER'S OWN REFERENCES IN THE SAME TEXT (the Banki átutalások survey, 2026-11-18, live: "HCUT/2026/003814 2026/00058
  S/2026/0005034"). The shapes below are invented numbers in the live shapes. WHAT TURNS THIS RED: a reference behind a letter
  and a slash read as ours (the customer's order number became "2026/003814"); a seven-digit serial cut to six (a half of a number
  read as a whole one); and the consequence, a cut or foreign number that equals one of our invoices as a number
  (`2026/000503` is 503, our ACRW-2026/00503) being offered for pairing.
*/
describe("the customer's own references are not ours", () => {
  it("a number behind a letter and a slash is the customer's (HCUT/, S/), ours beside it stays", () => {
    assert.deepEqual(numbers("KXT/2026/001234 2026/00058 S/2026/0005034"), [
      "2026/00058",
    ]);
    assert.deepEqual(
      numbers("KXT/2026/003674 E-CRPR-2026-1 S/2026/0004363"),
      [],
    );
    assert.deepEqual(numbers("H/2026/001234"), []);
  });

  it("our own prefix written with a slash is ours, with its prefix (barracuda, #2683)", () => {
    // main read "ACRW/2026/00503" as a bare 2026/00503 (any series); the slash after OUR prefix is the customer's way of writing it
    assert.deepEqual(numbers("ACRW/2026/00503"), ["ACRW-2026/00503"]);
    assert.deepEqual(numbers("ARCW / 2026/00503"), ["ARCW-2026/00503"]);
    // a foreign prefix with a slash stays foreign
    assert.deepEqual(numbers("ABCD/2026/00503"), []);
  });

  it("a seven-digit serial is not read as its first six digits, anywhere", () => {
    assert.deepEqual(numbers("2026/0005034"), []);
    assert.deepEqual(numbers("számla 2026/0000503 köszönjük"), []);
    // six digits still are a number (the customer's extra zero), and a list is not hurt
    assert.deepEqual(numbers("2026/000436"), ["2026/000436"]);
    assert.deepEqual(numbers("2026/00083,86"), ["2026/00083", "2026/00086"]);
  });

  it("a foreign or cut number that equals one of ours as a number is not offered for pairing", () => {
    const ours = [{ invoiceNumber: "ACRW-2026/00503", open: "10000" }];
    for (const text of [
      "S/2026/0000503",
      "2026/0000503",
      "KXT/2026/000503",
      "KXT/2026/00503",
    ])
      assert.equal(
        matchRemittance(text, "10000", ours).kind,
        "NO_REFERENCE",
        text,
      );
    // and the real one beside a foreign one is still offered
    assert.equal(
      matchRemittance("KXT/2026/001234 2026/00503", "10000", ours).kind,
      "EXACT",
    );
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
