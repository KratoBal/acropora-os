import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyChain } from "./partner-orders.service.js";
import {
  systemDocumentsOf,
  withSystemDocuments,
  type SystemDocumentSource,
} from "./partner-order-system-documents.js";

/*
  A LÁNC RENDSZER-DOKUMENTUMAI (kártya 88649353; Balázs, 2026-11-04 17:40 UTC; acrobot 42589). MI PIROSÍT:
  ha a rögzített verzió tárolt PDF-je nem kerül az Ajánlat lépésbe, vagy PDF nélkül is bekerül; ha a TIG
  generált és aláírt példánya rossz lépésbe megy; ha egy piszkozat vagy szám nélküli számla a láncba
  kerül; ha a lista számai nem a feltöltöttek és a rendszer-dokumentumok összegei.
*/
const source = (
  over: Partial<SystemDocumentSource> = {},
): SystemDocumentSource => ({
  quoteId: "q1",
  quoteNumber: "AJ-2026-0042",
  version: {
    id: "v2",
    versionNumber: 2,
    pdfStorageKey: "quotes/q1/v2.pdf",
    publishedAt: new Date("2026-11-01T09:00:00.000Z"),
  },
  certificates: [
    {
      id: "cert-1",
      number: "TI-2026-008",
      documents: [
        {
          id: "d1",
          type: "GENERATED_FORM",
          fileName: "TI-2026-008.pdf",
          createdAt: new Date("2026-11-04T10:00:00.000Z"),
        },
        {
          id: "d2",
          type: "SIGNED_FORM",
          fileName: "alairt.pdf",
          createdAt: new Date("2026-11-04T11:00:00.000Z"),
        },
      ],
      invoices: [
        {
          id: "inv-1",
          status: "ISSUED",
          invoiceNumber: "ACRS-2026-12",
          issueDate: new Date("2026-11-04T12:00:00.000Z"),
        },
      ],
    },
    {
      id: "cert-2",
      number: "TI-2026-009",
      documents: [
        {
          id: "d3",
          type: "GENERATED_FORM",
          fileName: "TI-2026-009.pdf",
          createdAt: new Date("2026-11-04T13:00:00.000Z"),
        },
      ],
      invoices: [
        { id: "inv-2", status: "DRAFT", invoiceNumber: null, issueDate: null },
      ],
    },
  ],
  ...over,
});

describe("systemDocumentsOf", () => {
  it("a lánc minden lépése a saját dokumentumával, a piszkozat számla nélkül", () => {
    assert.deepEqual(
      systemDocumentsOf(source()).map((d) => [d.step, d.kind, d.label]),
      [
        ["QUOTE", "QUOTE_PDF", "Ajánlat AJ-2026-0042 · 2. verzió"],
        [
          "COMPLETION",
          "CERTIFICATE_DOCUMENT",
          "Teljesítési igazolás TI-2026-008",
        ],
        [
          "SIGNED_COMPLETION",
          "CERTIFICATE_DOCUMENT",
          "Aláírt teljesítési igazolás TI-2026-008",
        ],
        ["INVOICE", "INVOICE_PDF", "Számla ACRS-2026-12"],
        [
          "COMPLETION",
          "CERTIFICATE_DOCUMENT",
          "Teljesítési igazolás TI-2026-009",
        ],
      ],
    );
  });

  it("tárolt PDF nélkül az Ajánlat lépés üres marad", () => {
    const docs = systemDocumentsOf(
      source({
        version: {
          id: "v2",
          versionNumber: 2,
          pdfStorageKey: null,
          publishedAt: null,
        },
        certificates: [],
      }),
    );
    assert.deepEqual(docs, []);
  });

  it("a letöltéshez a saját azonosítóit viszi", () => {
    const [quote, certificate, , invoice] = systemDocumentsOf(source());
    assert.deepEqual(quote, {
      kind: "QUOTE_PDF",
      step: "QUOTE",
      label: "Ajánlat AJ-2026-0042 · 2. verzió",
      quoteId: "q1",
      versionId: "v2",
      createdAt: "2026-11-01T09:00:00.000Z",
    });
    assert.equal(
      certificate!.kind === "CERTIFICATE_DOCUMENT" && certificate!.documentId,
      "d1",
    );
    assert.equal(
      invoice!.kind === "INVOICE_PDF" && invoice!.invoiceId,
      "inv-1",
    );
  });
});

describe("withSystemDocuments", () => {
  it("a lista számai a feltöltöttek és a rendszer-dokumentumok összegei", () => {
    const uploaded = { ...emptyChain(), QUOTE: 1, SIGNED_ORDER_FORM: 1 };
    assert.deepEqual(
      withSystemDocuments(uploaded, systemDocumentsOf(source())),
      {
        ...emptyChain(),
        QUOTE: 2,
        SIGNED_ORDER_FORM: 1,
        COMPLETION: 2,
        SIGNED_COMPLETION: 1,
        INVOICE: 1,
      },
    );
    assert.deepEqual(
      uploaded.COMPLETION,
      0,
      "the uploaded chain is not changed in place",
    );
  });

  // acrobot 42859: listed with the storno's number, but the chain stands as if it had no invoice
  it("a sztornózott számla nem számít a láncban, de látható marad", () => {
    const docs = systemDocumentsOf(
      source({
        certificates: [
          {
            id: "cert-1",
            number: "TI-2026-008",
            documents: [],
            invoices: [
              {
                id: "inv-1",
                status: "ISSUED",
                invoiceNumber: "ACRS-2026-12",
                issueDate: new Date("2026-11-04T13:00:00.000Z"),
                correctionInvoices: [{ invoiceNumber: "ACRS-2026-13" }],
              },
            ],
          },
        ],
      }),
    );
    const invoice = docs.find((d) => d.kind === "INVOICE_PDF")!;
    assert.equal(
      invoice.label,
      "Számla ACRS-2026-12 · Sztornózva (ACRS-2026-13)",
    );
    assert.equal(
      invoice.kind === "INVOICE_PDF" && invoice.stornoInvoiceNumber,
      "ACRS-2026-13",
    );
    assert.equal(withSystemDocuments(emptyChain(), docs).INVOICE, 0);
  });
});
