import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";

import type {
  DocumentKey,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import { BillingDocumentPdfService } from "./billing-document-pdf.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function service(
  row: Partial<BillingDocumentRow> | null,
  stored: Uint8Array | null = PDF,
) {
  const asked: DocumentKey[] = [];
  const documents = {
    find: async () => row as BillingDocumentRow | null,
  } as unknown as BillingDocumentsRepository;
  const store = {
    get: async (key: DocumentKey) => {
      asked.push(key);
      return stored;
    },
  } as unknown as DocumentStore;
  return { pdfs: new BillingDocumentPdfService(documents, store), asked };
}

const ISSUED = {
  id: "doc-1",
  status: "ISSUED",
  invoiceNumber: "E-ACR-2026-7",
  pdfStorageKey: "invoices/doc-1/billing-document.pdf",
} as Partial<BillingDocumentRow>;

describe("BillingDocumentPdfService", () => {
  it("serves the stored PDF of an issued document, named after its number", async () => {
    const { pdfs, asked } = service(ISSUED);
    const result = await pdfs.pdf("doc-1");
    assert.equal(result.bytes, PDF);
    assert.equal(result.fileName, "E-ACR-2026-7.pdf");
    assert.deepEqual(asked, [
      {
        owner: "invoice",
        ownerId: "doc-1",
        documentId: "billing-document.pdf",
      },
    ]);
  });

  it("refuses a draft with 409, without touching the store", async () => {
    const { pdfs, asked } = service({ ...ISSUED, status: "DRAFT" });
    await assert.rejects(pdfs.pdf("doc-1"), ConflictException);
    assert.deepEqual(asked, []);
  });

  it("refuses an issued document whose PDF never arrived, and one whose file is gone", async () => {
    await assert.rejects(
      service({ ...ISSUED, pdfStorageKey: null }).pdfs.pdf("doc-1"),
      ConflictException,
    );
    await assert.rejects(
      service(ISSUED, null).pdfs.pdf("doc-1"),
      ConflictException,
    );
  });

  it("does not find a row outside the module", async () => {
    await assert.rejects(service(null).pdfs.pdf("doc-1"), NotFoundException);
  });
});
