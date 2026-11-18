import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RANGE_LIMIT,
  matchRemittance,
  moneyCents,
  refMatchesInvoiceNumber,
  remittanceEbizNumbers,
  remittanceInvoiceRefs,
} from "./remittance-invoice-refs.js";

/*
  WHAT TURNS THIS RED (card aeddb2c3, Balázs 2026-11-04 16:36 UTC). The real remittance "2026/00083,86,85,84" not read
  as four invoices; a range, a full second number or a prefix lost; a guessed number (a longer shortening, a backward
  or too long range, a following amount); a reference matched to the wrong series; a pairing offered when one invoice
  is missing, ambiguous, or the amount is off by a fillér.
*/
const numbers = (text: string) =>
  remittanceInvoiceRefs(text)
    .filter((ref) => ref.literal === undefined)
    .map(
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

/*
  THE OTHER SHAPES OF OUR NUMBERS (the Banki átutalások survey, 2026-11-18, acrobot 55667; memory 2652: ACRW-/2026/ = cmfx,
  E-CRPR, E-CRPRW, CRPR = Számlázz.hu, EINV = eBIZ). Live: a 11 287 062 Ft credit naming "E-CRPR-2026-1" and a 1 121 819 Ft
  one naming "D-CRPR-7" (a díjbekérő: kind D in `NOT_PAYABLE_KIND`) stood as "no reference", hidden; eleven credits naming an
  EINV number the same. WHAT TURNS THIS RED: one of those numbers not read; a foreign look-alike read; a literal number
  matched loosely (E-CRPR-2026-1 is not E-CRPR-2026-10); an eBIZ number read as a Számlázz.hu one.
*/
describe("our Számlázz.hu numbers written in full, and eBIZ's", () => {
  const literals = (text: string) =>
    remittanceInvoiceRefs(text)
      .filter((ref) => ref.literal !== undefined)
      .map((ref) => ref.literal);

  it("E-CRPR, E-CRPRW, CRPR and the díjbekérő D-CRPR numbers are read in full, upper-cased", () => {
    assert.deepEqual(literals("E-CRPR-2026-1 utalás vissza"), [
      "E-CRPR-2026-1",
    ]);
    assert.deepEqual(literals("e-crprw-2026-12"), ["E-CRPRW-2026-12"]);
    assert.deepEqual(literals("CRPR-2026-5, CRPRW-2022-5"), [
      "CRPR-2026-5",
      "CRPRW-2022-5",
    ]);
    assert.deepEqual(literals("D-CRPR-7"), ["D-CRPR-7"]);
    assert.deepEqual(literals("D-CRPRW-12 és E-CRPR-2026-1"), [
      "D-CRPRW-12",
      "E-CRPR-2026-1",
    ]);
  });

  it("the customer's references around it, and the year/number shapes, stay as they were", () => {
    assert.deepEqual(literals("KXT/2026/003674 E-CRPR-2026-1 S/2026/0004363"), [
      "E-CRPR-2026-1",
    ]);
    assert.deepEqual(
      numbers("KXT/2026/003674 E-CRPR-2026-1 S/2026/0004363"),
      [],
    );
    assert.deepEqual(numbers("ACRW-2026/00083"), ["ACRW-2026/00083"]);
    assert.deepEqual(literals("ACRW-2026/00083"), []);
  });

  it("a look-alike is not a number: a letter before or after, a missing serial, another series", () => {
    for (const text of [
      "XD-CRPR-7",
      "E-CRPR-2026-1X",
      "D-CRPR",
      "E-CRPR-2026",
      "E-ABCD-2026-1",
      "CRPR-20261-5",
    ])
      assert.deepEqual(literals(text), [], text);
  });

  it("a literal reference matches only that exact number, any case", () => {
    const [ref] = remittanceInvoiceRefs("E-CRPR-2026-1");
    assert.ok(ref);
    assert.equal(refMatchesInvoiceNumber(ref, "E-CRPR-2026-1"), true);
    assert.equal(refMatchesInvoiceNumber(ref, "e-crpr-2026-1"), true);
    assert.equal(refMatchesInvoiceNumber(ref, "E-CRPR-2026-10"), false);
    assert.equal(refMatchesInvoiceNumber(ref, "ACRW-2026/00001"), false);
    // and a year/number reference never matches a literal number
    const [plain] = remittanceInvoiceRefs("2026/00001");
    assert.equal(refMatchesInvoiceNumber(plain!, "E-CRPR-2026-1"), false);
  });

  it("an eBIZ number (EINV + digits) is named by its text, any case, and is not ours", () => {
    assert.deepEqual(remittanceEbizNumbers("EINV000000819 számla kif."), [
      "EINV000000819",
    ]);
    assert.deepEqual(
      remittanceEbizNumbers("Jász-Plasztik Kft: einv000000813"),
      ["EINV000000813"],
    );
    assert.deepEqual(remittanceEbizNumbers("EINV0000000716, EINV000000811"), [
      "EINV0000000716",
      "EINV000000811",
    ]);
    assert.deepEqual(remittanceEbizNumbers("REINV12 vagy EINV"), []);
    assert.deepEqual(remittanceInvoiceRefs("EINV000000819"), []);
  });
});

/*
  A TELJES SZÁMLÁZZ.HU SZÁM UTÁN RÖVIDÍTETT LISTA ÉS TARTOMÁNY (Luca, 2026-11-18 14:57 UTC, acrobot 55990; az Acropora OS szál 1572626691002470542): a 3 001 010 Ft jóváírás közleménye
  "HC0000007106 E-CRPRW-2026-6,5", ez az E-CRPRW-2026-6 (1 165 860) és az E-CRPRW-2026-5 (1 835 150) összege, de csak az elsőt olvastuk. Ugyanazok az alakok, mint a `2026/00083,86` esetén (vesszős
  lista, "és", "+", tartomány), de a számok itt NEM nullával kitöltöttek: a további szám a SAJÁT teljes sorszáma (`,5` = az 5-ös), nem az utolsó számjegyeit cseréli. Amit nem lehet egyértelműen olvasni
  (rövidebb szám a kiindulónál: `12,3` lehet 3 vagy 13), azt nem találgatjuk: egy kitalált szám más vevő számlájához párosítana. MI PIROSÍT: ha Luca közleményéből nem lesz két szám; ha a lista, az "és", a
  "+" vagy a tartomány nem olvasódik; ha egy visszafelé vagy a korlátnál hosszabb tartomány, vagy egy kétértelmű rövidítés mégis szám lesz; ha a dátum vagy a másik formájú hivatkozás a lista tagja lesz.
*/
describe("shortened numbers after a full E-CRPR / CRPR / D-CRPR number", () => {
  const literals = (text: string) =>
    remittanceInvoiceRefs(text)
      .filter((ref) => ref.literal !== undefined)
      .map((ref) => ref.literal);

  it("Luca's memo: E-CRPRW-2026-6,5 is two invoices, the 6 and the 5", () => {
    assert.deepEqual(literals("HC0000007106 E-CRPRW-2026-6,5"), [
      "E-CRPRW-2026-6",
      "E-CRPRW-2026-5",
    ]);
  });

  it("a comma list, 'és', '+', ';' and '&' read the same way, in the same series and year", () => {
    assert.deepEqual(literals("E-CRPR-2026-1,2,3"), [
      "E-CRPR-2026-1",
      "E-CRPR-2026-2",
      "E-CRPR-2026-3",
    ]);
    for (const text of [
      "E-CRPR-2026-1 és 2",
      "E-CRPR-2026-1 + 2",
      "E-CRPR-2026-1; 2",
      "E-CRPR-2026-1 & 2",
    ])
      assert.deepEqual(
        literals(text),
        ["E-CRPR-2026-1", "E-CRPR-2026-2"],
        text,
      );
  });

  it("a range, within its limit only", () => {
    assert.deepEqual(literals("E-CRPRW-2026-5-8"), [
      "E-CRPRW-2026-5",
      "E-CRPRW-2026-6",
      "E-CRPRW-2026-7",
      "E-CRPRW-2026-8",
    ]);
    // backwards: only the base, nothing guessed
    assert.deepEqual(literals("E-CRPRW-2026-8-5"), ["E-CRPRW-2026-8"]);
    // longer than the limit: only the base
    assert.deepEqual(literals(`E-CRPRW-2026-1-${RANGE_LIMIT + 5}`), [
      "E-CRPRW-2026-1",
    ]);
  });

  it("the series without a year (D-CRPR) and the CRPR series shorten the same way", () => {
    assert.deepEqual(literals("D-CRPR-7,8"), ["D-CRPR-7", "D-CRPR-8"]);
    assert.deepEqual(literals("CRPRW-2022-5,6"), [
      "CRPRW-2022-5",
      "CRPRW-2022-6",
    ]);
  });

  it("a longer or equally long number is that number; a shorter one is ambiguous and is not read", () => {
    assert.deepEqual(literals("E-CRPR-2026-9,10"), [
      "E-CRPR-2026-9",
      "E-CRPR-2026-10",
    ]);
    assert.deepEqual(literals("E-CRPR-2026-12,13"), [
      "E-CRPR-2026-12",
      "E-CRPR-2026-13",
    ]);
    // 12,3 is the 3 or the 13: a person decides
    assert.deepEqual(literals("E-CRPR-2026-12,3"), ["E-CRPR-2026-12"]);
  });

  it("a date or a reference of another shape after the number is not a list member", () => {
    assert.deepEqual(literals("E-CRPR-2026-1, 2026-11-18"), ["E-CRPR-2026-1"]);
    assert.deepEqual(literals("E-CRPR-2026-1 2026-11-18"), ["E-CRPR-2026-1"]);
    assert.deepEqual(literals("E-CRPR-2026-5,2026/00083"), ["E-CRPR-2026-5"]);
    assert.deepEqual(numbers("E-CRPR-2026-5,2026/00083"), ["2026/00083"]);
    // two full literals in a list stay two (each with its own prefix)
    assert.deepEqual(literals("CRPR-2026-5, CRPRW-2022-5"), [
      "CRPR-2026-5",
      "CRPRW-2022-5",
    ]);
  });

  /*
    EGY ÖSSZEG NEM LISTATAG (barracuda, #2699): "E-CRPRW-2026-6, 5000 Ft" az 5000-es számlát, "E-CRPRW-2026-6, 3 001 010 Ft" a 3-ast nevezné (az első ezres csoport). A pontos összeg-kapu a
    téves párosítást megfogná, de a kézi párosításnál egy idegen számla jelenhetne meg javaslatként. MI PIROSÍT: ha szóköz + számjegy vagy Ft / HUF / forint előtt álló szám taggá lesz.
  */
  it("an amount after the number is not a list member (a space and a digit, or Ft / HUF / forint after it)", () => {
    for (const text of [
      "E-CRPRW-2026-6, 5000 Ft",
      "E-CRPRW-2026-6, 3 001 010 Ft",
      "E-CRPRW-2026-6 + 5000 HUF",
      "E-CRPRW-2026-6; 12000forint",
      "E-CRPRW-2026-6,5000Ft",
    ])
      assert.deepEqual(literals(text), ["E-CRPRW-2026-6"], text);
    // and a real list next to words stays a list
    assert.deepEqual(literals("utalás E-CRPRW-2026-6,5 köszönöm"), [
      "E-CRPRW-2026-6",
      "E-CRPRW-2026-5",
    ]);
    // a date after the member is not an amount (4 digits, not a thousands group)
    assert.deepEqual(literals("E-CRPRW-2026-6,5 2026.11.18"), [
      "E-CRPRW-2026-6",
      "E-CRPRW-2026-5",
    ]);
    assert.deepEqual(literals("E-CRPRW-2026-6, 5"), [
      "E-CRPRW-2026-6",
      "E-CRPRW-2026-5",
    ]);
  });

  it("Luca's credit: 3 001 010 is exactly E-CRPRW-2026-6 (1 165 860) plus E-CRPRW-2026-5 (1 835 150)", () => {
    const result = matchRemittance("HC0000007106 E-CRPRW-2026-6,5", "3001010", [
      { invoiceNumber: "E-CRPRW-2026-6", open: "1165860" },
      { invoiceNumber: "E-CRPRW-2026-5", open: "1835150" },
      { invoiceNumber: "E-CRPRW-2026-4", open: "999" },
    ]);
    assert.equal(result.kind, "EXACT");
    if (result.kind === "EXACT")
      assert.deepEqual(
        result.invoices.map((invoice) => invoice.invoiceNumber).sort(),
        ["E-CRPRW-2026-5", "E-CRPRW-2026-6"],
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
