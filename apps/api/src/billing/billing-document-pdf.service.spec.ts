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

  it("serves an issued TIG invoice's PDF from where the TIG issue stored it (an own row since #2421)", async () => {
    const { pdfs, asked } = service({
      ...ISSUED,
      pdfStorageKey: "invoices/doc-1/invoice.pdf",
    });
    assert.equal((await pdfs.pdf("doc-1")).bytes, PDF);
    assert.deepEqual(asked, [
      { owner: "invoice", ownerId: "doc-1", documentId: "invoice.pdf" },
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

/*
  THE PDF FETCHED AGAIN (card 3e5e85d0, acrobot 63239 (a)): an issued invoice whose PDF the store refused at issue gets it
  from Számlázz.hu by its number when someone opens it, through the same Agent download the issuing resolution uses. WHAT
  TURNS THIS RED: the missing PDF stays a 409 though Számlázz.hu has it; the bytes are not served when the store still
  refuses; a PDF key is recorded without the file written; Számlázz.hu is asked outside the live mode.
*/
describe("BillingDocumentPdfService fetches a missing PDF again", () => {
  const FETCHED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const NO_PDF = {
    ...ISSUED,
    pdfStorageKey: null,
  } as Partial<BillingDocumentRow>;
  const LIVE = { BILLING_ISSUE_ENABLED: "true" } as NodeJS.ProcessEnv;

  function again(
    options: {
      refuses?: boolean;
      env?: NodeJS.ProcessEnv;
      respond?: () => Promise<{ pdf?: Uint8Array }>;
    } = {},
  ) {
    const calls = {
      downloads: [] as string[],
      put: [] as DocumentKey[],
      setPdf: [] as string[],
    };
    const documents = {
      find: async () => NO_PDF as BillingDocumentRow,
    } as unknown as BillingDocumentsRepository;
    const store = {
      get: async () => null,
      put: async (key: DocumentKey) => {
        if (options.refuses) throw new Error("DocumentStoreNotReadyError");
        calls.put.push(key);
      },
    } as unknown as DocumentStore;
    const issueRepository = {
      setPdf: async (_id: string, key: string) => calls.setPdf.push(key),
    };
    const credentials = { resolve: async () => ({ agentKey: "kulcs" }) };
    const client = {
      downloadInvoicePdf: async (xml: string) => {
        calls.downloads.push(xml);
        return options.respond ? options.respond() : { pdf: FETCHED };
      },
    };
    const pdfs = new BillingDocumentPdfService(
      documents,
      store,
      issueRepository as never,
      credentials as never,
      client as never,
      options.env ?? LIVE,
    );
    return { pdfs, calls };
  }

  it("serves it by its number, stores it and records the key", async () => {
    const { pdfs, calls } = again();
    const result = await pdfs.pdf("doc-1");
    assert.equal(result.bytes, FETCHED);
    assert.equal(result.fileName, "E-ACR-2026-7.pdf");
    assert.equal(calls.downloads.length, 1);
    assert.match(calls.downloads[0]!, /E-ACR-2026-7/);
    assert.deepEqual(calls.put, [
      {
        owner: "invoice",
        ownerId: "doc-1",
        documentId: "billing-document.pdf",
      },
    ]);
    assert.deepEqual(calls.setPdf, ["invoices/doc-1/billing-document.pdf"]);
  });

  it("serves it while the store still refuses, and records no key", async () => {
    const { pdfs, calls } = again({ refuses: true });
    const result = await pdfs.pdf("doc-1");
    assert.equal(result.bytes, FETCHED);
    assert.deepEqual(calls.setPdf, []);
  });

  it("asks nothing outside the live mode, and keeps the 409; nor when Számlázz.hu has no PDF", async () => {
    const off = again({ env: {} as NodeJS.ProcessEnv });
    await assert.rejects(off.pdfs.pdf("doc-1"), ConflictException);
    assert.equal(off.calls.downloads.length, 0);

    const none = again({ respond: async () => ({}) });
    await assert.rejects(none.pdfs.pdf("doc-1"), ConflictException);
  });
});
