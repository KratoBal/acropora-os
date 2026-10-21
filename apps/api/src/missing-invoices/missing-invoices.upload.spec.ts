import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";
import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import type { MissingInvoiceJevService } from "./missing-invoice-jev.service.js";
import type { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

const USER = { id: "user-1" } as AuthenticatedUser;

function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc).fontSize(10);
    lines.forEach((line, i) => doc.text(line, 30, 40 + i * 16));
    doc.end();
  });
}

function setup(
  options: {
    narrative?: string;
    known?: { number: string; supplierTaxNumber: string }[];
  } = {},
) {
  const uploads: Record<string, unknown>[] = [];
  const resolved: { bankTransactionId: string; documentId: string }[] = [];
  const repository = {
    accounts: async () => [
      {
        id: "acc",
        accountNumber: "1170900220624460",
        currency: "HUF",
        name: "Fő számla",
      },
    ],
    credits: async () => [],
    debits: async () => [
      {
        id: "debit-1",
        bankAccountId: "acc",
        amount: new Prisma.Decimal(12700),
        currency: "HUF",
        bookingDate: new Date("2026-08-12T00:00:00Z"),
        counterpartyAccount: null,
        counterpartyName: "Allianz Hungária Zrt.",
        narrative: options.narrative ?? "",
        transactionType: "ÁTUTALÁS",
        comment: null,
        categoryOverride: null,
        paperOriginalAt: null,
      },
    ],
    statementCoverage: async () => new Set(["acc:2026-08"]),
    manualMatches: async () => new Map(),
    candidates: async () => [],
    uncheckedMailboxContent: async () => [],
    setPayee: async () => undefined,
    navNumbers: async (base: string) =>
      base === "27045364" ? ["4042V0000011711", "4042V0000010763"] : [],
    knownNumbers: async () => options.known ?? [],
    uploadAndPair: async (input: Record<string, unknown>) => {
      uploads.push(input);
      return "doc-1";
    },
  } as unknown as MissingInvoicesRepository;
  const reader = {
    read: async () => {
      throw new Error("ismeretlen szállítói formátum");
    },
  } as unknown as SupplierInvoiceImportService;
  const jev = {
    resolveOnPair: async (input: {
      bankTransactionId: string;
      documentId: string;
    }) => void resolved.push(input),
  } as unknown as MissingInvoiceJevService;
  return {
    missing: new MissingInvoicesService(repository, reader, {}, jev),
    uploads,
    resolved,
  };
}

describe("uploading an invoice from the drawer", () => {
  it("refuses a file that is not a PDF, before storing anything", async () => {
    const { missing, uploads } = setup();
    await assert.rejects(
      missing.upload(
        "debit-1",
        { originalname: "szamla.txt", buffer: Buffer.from("nem pdf") },
        "INVOICE",
        USER,
      ),
      (error: unknown) =>
        error instanceof BadRequestException && /Csak PDF/.test(error.message),
    );
    assert.equal(uploads.length, 0);
  });

  /*
    A SZÖVEG NÉLKÜLI PDF IS TÁROLÓDIK (kártya 847bca33, acrobot 34446): élesben
    egy tömörített PDF (kompress.pdf) feltöltése nem hagyott sort, mert a
    szövegkinyerés kivétele 400-zal elutasította. MI PIROSÍT: ha a feltöltés
    újra elutasítja, vagy olvasatot, vevőt találgat egy szöveg nélküli fájlra.
  */
  it("stores a PDF whose text cannot be read: unread, no reading, an unknown payee", async () => {
    const { missing, uploads, resolved } = setup();
    await missing.upload(
      "debit-1",
      { originalname: "kompress.pdf", buffer: Buffer.from("%PDF-1.4 torott") },
      "INVOICE",
      USER,
    );
    assert.equal(uploads.length, 1);
    assert.deepEqual(
      [
        uploads[0]!.fileName,
        uploads[0]!.importResult,
        uploads[0]!.textReading,
        uploads[0]!.payee,
        uploads[0]!.bankTransactionId,
      ],
      ["kompress.pdf", null, null, "UNKNOWN", "debit-1"],
    );
    assert.deepEqual(resolved, [
      { bankTransactionId: "debit-1", documentId: "doc-1" },
    ]);
  });

  it("stores an unreadable-format PDF too, checks the payee from its text, and keeps the kind", async () => {
    const { missing, uploads } = setup();
    const bytes = await pdf([
      "Díjértesítő",
      "Szerződő: Acropora Kft., adószám: 23916229-2-13",
    ]);
    await missing.upload(
      "debit-1",
      { originalname: "dijertesito.pdf", buffer: bytes },
      "PREMIUM_NOTICE",
      USER,
    );
    assert.equal(uploads.length, 1);
    assert.deepEqual(
      [
        uploads[0]!.kind,
        uploads[0]!.payee,
        uploads[0]!.importResult,
        uploads[0]!.bankTransactionId,
      ],
      ["PREMIUM_NOTICE", "COMPANY", null, "debit-1"],
    );
  });

  it("resolves the Jev suggestion with the uploaded document: none of the candidates was the one (acrobot 25880)", async () => {
    const { missing, resolved } = setup();
    await missing.upload(
      "debit-1",
      { originalname: "szamla.pdf", buffer: await pdf(["SZÁMLA"]) },
      "INVOICE",
      USER,
    );
    assert.deepEqual(resolved, [
      { bankTransactionId: "debit-1", documentId: "doc-1" },
    ]);
    // egy elutasított feltöltés nem párosít, tehát nem is old fel
    const refused = setup();
    await assert.rejects(
      refused.missing.upload(
        "debit-1",
        { originalname: "x.pdf", buffer: Buffer.from("nem pdf") },
        "INVOICE",
        USER,
      ),
    );
    assert.deepEqual(refused.resolved, []);
  });

  it("marks a PDF without our tax number as not the company's", async () => {
    const { missing, uploads } = setup();
    await missing.upload(
      "debit-1",
      {
        originalname: "receipt.pdf",
        buffer: await pdf(["Receipt", "Bill to: John Doe"]),
      },
      "INVOICE",
      USER,
    );
    assert.equal(uploads[0]!.payee, "NOT_COMPANY");
  });

  /*
    AZ ÁLTALÁNOS OLVASÓ A FELTÖLTÉSRE IS (barracuda mérése, 2026-10-05: élesben
    19 feltöltésből 19 olvasatlan). MI PIROSÍT: az ismeretlen szállítói
    formátumú feltöltés számlaszám nélkül tárolódik, ezért soha nem vonódik
    össze a NAV- vagy Számlázz.hu-sorával.
  */
  it("an unknown supplier format is read by the general reader: number and supplier", async () => {
    const { missing, uploads } = setup();
    await missing.upload(
      "debit-1",
      {
        originalname: "tesla_invoice.pdf",
        buffer: await pdf([
          "Tesla Hungary Kft.",
          "Adószám: 27045364-2-44",
          "Számla",
          "Számla sorszáma: 4042V0000011711",
          "Kelt: 2026.09.10.",
          "Fizetendő: 4 400 Ft",
        ]),
      },
      "INVOICE",
      USER,
    );
    const reading = uploads[0]!.textReading as {
      invoiceNumber: string | null;
      supplierTaxNumber: string | null;
    } | null;
    assert.equal(uploads[0]!.importResult, null);
    assert.equal(reading?.invoiceNumber, "4042V0000011711");
    assert.match(reading?.supplierTaxNumber ?? "", /27045364/);
  });

  /*
    A BEGYŰJTÉS TÖBBI LÉPÉSE A FELTÖLTÉSEN IS (kártya 847bca33). Élesben egy
    francia szállító számlája a levélből számmal jött be, a feltöltésből szám
    nélkül, ezért a két példány nem vonódott össze, és a jelölt-listában a
    fájlnév állt a szám helyén. MI PIROSÍT: ha a feltöltés nem nézi a saját
    terhelése közleményét, az ismert számokat vagy a címkés végösszeget.
  */
  const AMBLARD = [
    "AMBLARD SAS",
    "TVA intracommunautaire: FR61393374657",
    "Client: Acropora Kft., HU23916229",
    "Référence F2602896",
    "Montant total 180,00 EUR",
  ];
  const textReadingOf = (upload: Record<string, unknown>) =>
    upload.textReading as {
      invoiceNumber: string | null;
      numberFrom: string | null;
      supplierTaxNumber: string | null;
      bankReference?: string;
      gross?: string;
      currency?: string;
    } | null;

  it("a foreign invoice takes its number from its OWN debit's narrative, and its total from the label", async () => {
    const { missing, uploads } = setup({
      narrative: "AMBLARD SAS F2602896 KARTYAS VASARLAS",
    });
    await missing.upload(
      "debit-1",
      { originalname: "HUAAB[30].PDF", buffer: await pdf(AMBLARD) },
      "INVOICE",
      USER,
    );
    const reading = textReadingOf(uploads[0]!);
    assert.deepEqual(
      [
        reading?.invoiceNumber,
        reading?.numberFrom,
        reading?.bankReference,
        reading?.supplierTaxNumber,
        reading?.gross,
        reading?.currency,
      ],
      ["F2602896", "BANK", "F2602896", "FR61393374657", "180", "EUR"],
    );
  });

  it("the control: the same PDF beside a debit that does not name it stays without a number", async () => {
    const { missing, uploads } = setup({ narrative: "AMBLARD SAS" });
    await missing.upload(
      "debit-1",
      { originalname: "HUAAB[30].PDF", buffer: await pdf(AMBLARD) },
      "INVOICE",
      USER,
    );
    const reading = textReadingOf(uploads[0]!);
    assert.deepEqual(
      [reading?.invoiceNumber, reading?.numberFrom, reading?.gross],
      [null, null, "180"],
    );
  });

  it("a known incoming number in the text names the invoice when the supplier's tax number is not in it", async () => {
    const { missing, uploads } = setup({
      known: [{ number: "U26/03861-SZ", supplierTaxNumber: "11223344-2-13" }],
    });
    await missing.upload(
      "debit-1",
      {
        originalname: "szamla.pdf",
        buffer: await pdf([
          "Tisza 97 Kft.",
          "Vevő: Acropora Kft., 23916229-2-42",
          "Számla",
          "U26/03861-SZ",
          "Végösszeg: 12 700 Ft",
        ]),
      },
      "INVOICE",
      USER,
    );
    const reading = textReadingOf(uploads[0]!);
    assert.deepEqual(
      [
        reading?.invoiceNumber,
        reading?.numberFrom,
        reading?.supplierTaxNumber,
        reading?.gross,
        reading?.currency,
      ],
      ["U26/03861-SZ", "NAV", "11223344-2-13", "12700", "HUF"],
    );
  });
});
