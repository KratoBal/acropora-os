import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import { classifyCodReference, orderKeyOf } from "./gls-cod-reference.js";
import {
  GlsDocumentError,
  readGlsDocument,
  type GlsCodReport,
  type GlsInvoiceAttachment,
} from "./gls-documents.parser.js";

const ADDRESS = "Kitalalt Cimzett, 0000 Kitalalt utca 1";

function codReport(overrides: { total?: number } = {}) {
  return glsXlsx({
    WeeklyThu: [
      ["GLS General Logistics Systems Hungary Kft."],
      [],
      ["Ügyfél név: KITALALT KFT."],
      ["Email:: kitalalt@example.com"],
      ["Bankszámlaszám: 00000000-00000000"],
      ["Utalás dátuma: 2026. 09. 03."],
      [],
      [
        "Jelentés szám",
        "Csomagszám",
        "Utánvét hivatkozás",
        "Kiszállítási dátum",
        "Utánvét összeg",
        "",
        "Levelezési cím",
      ],
      [
        "127711714",
        "1000000001",
        "ACRW-2026/00001",
        "2026-08-28",
        28900,
        "HUF",
        ADDRESS,
      ],
      [
        "127711714",
        "1000000002",
        "2026/00002",
        "2026-08-28",
        27450,
        "HUF",
        ADDRESS,
      ],
      [null, null, null, null, overrides.total ?? 56350, "HUF", null],
    ],
  });
}

function report(buffer: Buffer): GlsCodReport {
  const document = readGlsDocument(
    buffer,
    "100031291_HUF_20260903_080032.xlsx",
  );
  assert.equal(document.kind, "COD_REPORT");
  return (document as { report: GlsCodReport }).report;
}

const DELIVERY_HEADER = [
  "Számlaszám / Invoice number",
  "Számla kiállítás dátuma / Invoice date",
  "Csomagszám / Parcel number",
  "Ügyfél hivatkozás / Client reference",
  "Utánvét hivatkozás / COD Reference",
  "Felvétel dátuma / Pick up date",
  "Kiszállítás napja / Delivery date",
  "VÉGÖSSZEG / Total amount",
  "Pénznem / Currency",
  "Címzett neve / Addressee name",
  "Kiszállítási cím / Delivery address",
];

function invoiceAttachment() {
  return glsXlsx({
    "Delivery Details": [
      DELIVERY_HEADER,
      [
        "HU00000001",
        46283.0501772338,
        "1000000001",
        "11111-000001",
        "ACRW-2026/00001",
        46266,
        46267,
        3166.5,
        "HUF",
        "Kitalalt Cimzett",
        ADDRESS,
      ],
      [
        "HU00000001",
        46283.0501772338,
        "1000000002",
        null,
        "2026/00002",
        46275,
        46276,
        3244.5,
        "HUF",
        "Kitalalt Cimzett",
        ADDRESS,
      ],
      [
        "HU00000001",
        46283.0501772338,
        "1000000003",
        "11111-000003",
        null,
        46275,
        46276,
        2841.5,
        "HUF",
        "Kitalalt Cimzett",
        ADDRESS,
      ],
    ],
    // the surcharge sheet's columns vary (9 layouts measured): only three read
    "Services Surcharges details": [
      [
        "Csomagszám / Parcel number",
        "Előértesítés SMS-ben (SM2) / Preadvice Service",
        "Utánvét összege / COD value",
        "Utánvét díja (COD) / Cash on delivery fee",
      ],
      ["1000000001", 0, 28900, 905],
      ["1000000002", 66, 27450, 905],
      ["1000000003", 0, 0, 0],
    ],
    "Credit card fee details": [
      [
        "Csomagszám / Parcel ID",
        "VÉGÖSSZEG / Total amount",
        "Client reference",
        "COD Reference",
      ],
      ["1000000001", 286, "11111-000001", "ACRW-2026/00001"],
      // a card fee for a parcel invoiced on an earlier invoice
      ["0999999999", 100, null, "ACRW-2026/00000"],
    ],
    "Bank fee details": [["Ügyfél azonosító / Partner ID"]],
  });
}

function attachment(buffer: Buffer, fileName: string): GlsInvoiceAttachment {
  const document = readGlsDocument(buffer, fileName);
  assert.equal(document.kind, "INVOICE_ATTACHMENT");
  return (document as { attachment: GlsInvoiceAttachment }).attachment;
}

function rejects(buffer: Buffer, code: string) {
  assert.throws(
    () => readGlsDocument(buffer, "x.xlsx"),
    (error: unknown) =>
      error instanceof GlsDocumentError && error.code === code,
  );
}

describe("readGlsDocument: the COD report", () => {
  it("reads the transfer, line by line, and never the address", () => {
    const result = report(codReport());
    assert.equal(result.transferDate, "2026-09-03");
    assert.equal(result.currency, "HUF");
    assert.equal(result.total, 56350);
    assert.deepEqual(result.lines, [
      {
        rowNumber: 9,
        reportNumber: "127711714",
        parcelNumber: "1000000001",
        codReference: "ACRW-2026/00001",
        deliveryDate: "2026-08-28",
        amount: 28900,
      },
      {
        rowNumber: 10,
        reportNumber: "127711714",
        parcelNumber: "1000000002",
        codReference: "2026/00002",
        deliveryDate: "2026-08-28",
        amount: 27450,
      },
    ]);
    assert.ok(!JSON.stringify(result).includes("Kitalalt"));
  });

  it("reads the 2022 English layout, with the date in its own cell", () => {
    const result = report(
      glsXlsx({
        Sheet1: [
          ["GLS General Logistics Systems Hungary Kft."],
          ["Release Date", "2022-02-10"],
          [
            "Journal No.",
            "Parcel Number",
            "COD Reference",
            "Delivery Date",
            "COD Amount",
            "",
            "Postal Address",
          ],
          [
            "1234567",
            "1000000009",
            "ACRW-2022/00009",
            "2022-02-02",
            9380,
            "HUF",
            ADDRESS,
          ],
          [null, null, null, null, 9380, "HUF", null],
        ],
      }),
    );
    assert.equal(result.transferDate, "2022-02-10");
    assert.equal(result.lines[0]!.codReference, "ACRW-2022/00009");
    assert.equal(result.total, 9380);
  });

  it("refuses a report whose lines do not add up to its total", () => {
    rejects(codReport({ total: 56351 }), "GLS_COD_TOTAL_MISMATCH");
  });
});

describe("readGlsDocument: the invoice attachment", () => {
  it("reads the fee invoice parcel by parcel, with the COD and card fees", () => {
    const result = attachment(
      invoiceAttachment(),
      "SettlementDocument_HU00000001_20260918011215.xlsx",
    );
    assert.equal(result.invoiceNumber, "HU00000001");
    assert.equal(result.invoiceDate, "2026-09-18");
    assert.equal(result.currency, "HUF");
    assert.equal(result.feeTotal, 9252.5);
    assert.equal(result.cardFeeTotal, 386);
    assert.deepEqual(result.parcels[0], {
      parcelNumber: "1000000001",
      clientReference: "11111-000001",
      codReference: "ACRW-2026/00001",
      pickupDate: "2026-09-01",
      deliveryDate: "2026-09-02",
      fee: 3166.5,
      codValue: 28900,
      codFee: 905,
      cardFee: 286,
    });
    assert.equal(result.parcels[2]!.codValue, 0);
    assert.deepEqual(
      result.parcels.map((parcel) => parcel.parcelNumber),
      ["1000000001", "1000000002", "1000000003", "0999999999"],
    );
    assert.ok(!JSON.stringify(result).includes("Kitalalt"));
  });

  it("takes the invoice number from the file name when no parcel carries it", () => {
    // measured once: an attachment with only a card fee
    const result = attachment(
      glsXlsx({
        "Delivery Details": [DELIVERY_HEADER],
        "Services Surcharges details": [],
        "Credit card fee details": [
          ["Csomagszám / Parcel ID", "VÉGÖSSZEG / Total amount"],
          ["1000000001", 120],
        ],
      }),
      "SettlementDocument_HU00391589_20240306171649.xlsx",
    );
    assert.equal(result.invoiceNumber, "HU00391589");
    assert.equal(result.cardFeeTotal, 120);
    assert.equal(result.feeTotal, 0);
  });
});

describe("readGlsDocument: anything else", () => {
  it("refuses a file that is not an XLSX, and a workbook it does not know", () => {
    rejects(Buffer.from("not a zip at all"), "GLS_XLSX_INVALID");
    rejects(glsXlsx({ Arlista: [["Cikkszám", "Ár"]] }), "GLS_DOCUMENT_UNKNOWN");
  });
});

describe("classifyCodReference", () => {
  it("tells an invoice number from an order key and a bare number", () => {
    assert.deepEqual(classifyCodReference("ACRW-2026/00469"), {
      kind: "INVOICES",
      invoiceNumbers: ["ACRW-2026/00469"],
    });
    assert.deepEqual(classifyCodReference("ACRW-2025/01122, ACRW-2025/01123"), {
      kind: "INVOICES",
      invoiceNumbers: ["ACRW-2025/01122", "ACRW-2025/01123"],
    });
    assert.deepEqual(classifyCodReference("ACRB-2026/00012"), {
      kind: "INVOICES",
      invoiceNumbers: ["ACRB-2026/00012"],
    });
    assert.deepEqual(classifyCodReference("47679-198934"), {
      kind: "ORDER_KEY",
      orderKey: "47679-198934",
    });
    // never completed with a guessed prefix: only suggested
    assert.deepEqual(classifyCodReference("2026/00123"), {
      kind: "BARE_INVOICE",
      suggestion: "ACRW-2026/00123",
    });
    assert.deepEqual(classifyCodReference("CRPRW-2022-5"), { kind: "UNKNOWN" });
    assert.deepEqual(classifyCodReference(" "), { kind: "EMPTY" });
    assert.deepEqual(classifyCodReference(null), { kind: "EMPTY" });
  });

  it("reads a client reference as an order key only when it is one", () => {
    assert.equal(orderKeyOf("47679-198934"), "47679-198934");
    assert.equal(orderKeyOf("ACRW-2026/00469"), null);
    assert.equal(orderKeyOf(null), null);
  });
});
