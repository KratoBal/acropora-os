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

function setup() {
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
        narrative: "",
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

  it("refuses a file that only starts like a PDF", async () => {
    const { missing, uploads } = setup();
    await assert.rejects(
      missing.upload(
        "debit-1",
        { originalname: "torott.pdf", buffer: Buffer.from("%PDF-1.4 torott") },
        "INVOICE",
        USER,
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /nem olvasható/.test(error.message),
    );
    assert.equal(uploads.length, 0);
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
});
