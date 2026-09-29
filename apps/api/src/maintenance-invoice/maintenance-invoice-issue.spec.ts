import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { maintenanceInvoiceIssueEnabled } from "./maintenance-invoice-issue.config.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import type { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * THE REAL ISSUE (146ccc61). NO TEST CALLS SZÁMLÁZZ.HU: the client is always
 * this hand-written fake, never `HttpSzamlazzAgentClient` (acrobot's condition
 * for this card, and Balázs's). The Agent key is the fake provider's too.
 *
 * The repository fake keeps ONE invoice row with its status, so a race and a
 * stuck issue are measured on the same state the service would change.
 */
const ON = { MAINTENANCE_INVOICE_ISSUE_ENABLED: "true" };

const certificate = {
  id: "cert-1",
  number: "TIG-2026-0007",
  issuedAt: new Date("2026-09-24T00:00:00.000Z"),
  serviceJob: {
    customer: {
      id: "customer-1",
      displayName: "Fővárosi Állatkert",
      taxNumber: "12345678-2-42",
      addresses: [
        {
          line1: "Állatkerti körút 6-12.",
          line2: null,
          postalCode: "1146",
          city: "Budapest",
        },
      ],
    },
  },
  items: [
    {
      description: "Akvárium karbantartás",
      quantity: new Prisma.Decimal(1),
      unitNet: new Prisma.Decimal(100000),
      vatRatePercent: new Prisma.Decimal(27),
    },
  ],
  documents: [{ type: "SIGNED_FORM" }],
};

const ISSUED_RESPONSE = {
  successful: true,
  invoiceNumber: "ACRS-2026-1",
  netTotal: 100000,
  grossTotal: 127000,
  pdf: Buffer.from("real-invoice-pdf"),
};

interface Row {
  id: string;
  status: "DRAFT" | "ISSUING" | "ISSUED";
  completionCertificateId: string | null;
  currency: string;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  createdAt: Date;
  invoiceNumber: string | null;
  issueDate: Date | null;
  syncError: string | null;
  pdfStorageKey: string | null;
}

function harness(options: {
  environment?: NodeJS.ProcessEnv;
  status?: Row["status"];
  grossOnDraft?: number;
  response?: unknown;
  clientError?: Error;
  clientDelayMs?: number;
  putError?: Error;
}) {
  const row: Row = {
    id: "invoice-1",
    status: options.status ?? "DRAFT",
    completionCertificateId: "cert-1",
    currency: "HUF",
    netAmount: new Prisma.Decimal(100000),
    vatAmount: new Prisma.Decimal(27000),
    grossAmount: new Prisma.Decimal(options.grossOnDraft ?? 127000),
    createdAt: new Date("2026-09-24T18:00:00.000Z"),
    invoiceNumber: null,
    issueDate: null,
    syncError: null,
    pdfStorageKey: "invoices/invoice-1/preview.pdf",
  };
  const sent: string[] = [];
  const stored = new Map<string, Uint8Array>();
  const repository = {
    invoiceById: async () => ({ ...row, lines: [] }),
    claimForIssue: async () => {
      if (row.status !== "DRAFT") return false;
      row.status = "ISSUING";
      return true;
    },
    releaseClaim: async () => {
      if (row.status === "ISSUING") row.status = "DRAFT";
    },
    markOutcomeUnknown: async (_id: string, note: string) => {
      if (row.status === "ISSUING") row.syncError = note;
    },
    markIssued: async (
      _id: string,
      issued: {
        invoiceNumber: string;
        issueDate: Date;
        pdfStorageKey: string | null;
      },
    ) => {
      Object.assign(row, { status: "ISSUED", syncError: null, ...issued });
      return { ...row, lines: [] };
    },
    invoicePdfLookup: async () => ({
      id: row.id,
      status: row.status,
      invoiceNumber: row.invoiceNumber,
      pdfStorageKey: row.pdfStorageKey,
    }),
  } as unknown as MaintenanceInvoiceRepository;
  const client = {
    generateInvoice: async (xml: string) => {
      sent.push(xml);
      if (options.clientDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.clientDelayMs),
        );
      if (options.clientError) throw options.clientError;
      return options.response ?? ISSUED_RESPONSE;
    },
  } as unknown as SzamlazzAgentClient;
  const documentStore = {
    put: async (
      key: { ownerId: string; documentId: string },
      bytes: Uint8Array,
    ) => {
      if (options.putError) throw options.putError;
      stored.set(`${key.ownerId}/${key.documentId}`, bytes);
    },
    get: async (key: { ownerId: string; documentId: string }) =>
      stored.get(`${key.ownerId}/${key.documentId}`) ??
      (key.documentId === "preview.pdf" ? Buffer.from("preview-pdf") : null),
  } as unknown as DocumentStore;
  const service = new MaintenanceInvoiceDraftService(
    {
      detail: async () => certificate,
    } as unknown as CompletionCertificatesRepository,
    repository,
    {
      resolve: async () => ({
        agentKey: "fake-key",
        source: "database",
        revision: "db:1",
      }),
    } as unknown as SzamlazzCredentialProvider,
    documentStore,
    client,
    options.environment ?? ON,
  );
  return { service, row, sent, stored };
}

describe("maintenanceInvoiceIssueEnabled", () => {
  it("only 'true' turns it on; missing, false and anything else is off", () => {
    assert.equal(maintenanceInvoiceIssueEnabled({}), false);
    for (const value of ["false", "1", "yes", "", " "])
      assert.equal(
        maintenanceInvoiceIssueEnabled({
          MAINTENANCE_INVOICE_ISSUE_ENABLED: value,
        }),
        false,
        value,
      );
    for (const value of ["true", " TRUE ", "True\n"])
      assert.equal(
        maintenanceInvoiceIssueEnabled({
          MAINTENANCE_INVOICE_ISSUE_ENABLED: value,
        }),
        true,
        value,
      );
  });
});

describe("MaintenanceInvoiceDraftService.issue", () => {
  it("with the switch OFF it refuses before any Számlázz.hu call, and the draft stays", async () => {
    const { service, row, sent } = harness({ environment: {} });
    await assert.rejects(() => service.issue("invoice-1"), ConflictException);
    assert.equal(sent.length, 0);
    assert.equal(row.status, "DRAFT");
  });

  it("issues for real: no preview flag in the request, the number and the REAL PDF on the row", async () => {
    const { service, row, sent, stored } = harness({});
    const summary = await service.issue("invoice-1");

    assert.equal(sent.length, 1);
    assert.equal(
      sent[0]!.includes("elonezetpdf"),
      false,
      "a real issue carries no preview flag",
    );
    assert.equal(
      sent[0]!.includes("<rendelesSzam>TIG-2026-0007</rendelesSzam>"),
      true,
    );
    assert.equal(row.status, "ISSUED");
    assert.equal(summary.invoiceNumber, "ACRS-2026-1");
    assert.equal(row.pdfStorageKey, "invoices/invoice-1/invoice.pdf");
    assert.equal(
      Buffer.from(stored.get("invoice-1/invoice.pdf")!).toString(),
      "real-invoice-pdf",
    );
    // what the maintenance package reads is the real PDF, not the preview
    assert.equal(
      (await service.pdfFor("invoice-1")).toString(),
      "real-invoice-pdf",
    );
  });

  it("two requests at the same moment make ONE Számlázz.hu call", async () => {
    const { service, sent } = harness({ clientDelayMs: 20 });
    const results = await Promise.allSettled([
      service.issue("invoice-1"),
      service.issue("invoice-1"),
    ]);
    assert.equal(sent.length, 1);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
  });

  it("an unknown outcome stays ISSUING with the reason, and is NOT tried again", async () => {
    const { service, row, sent } = harness({
      clientError: new TypeError("fetch failed"),
    });
    await assert.rejects(
      () => service.issue("invoice-1"),
      ServiceUnavailableException,
    );
    assert.equal(row.status, "ISSUING");
    assert.match(row.syncError ?? "", /nem érkezett meg/);

    await assert.rejects(() => service.issue("invoice-1"), ConflictException);
    assert.equal(sent.length, 1, "no second real call");
  });

  it("a definite refusal from Számlázz.hu puts the draft back", async () => {
    const { service, row } = harness({
      response: {
        successful: false,
        errorCode: "57",
        errorMessage: "Hibás adószám",
      },
    });
    await assert.rejects(() => service.issue("invoice-1"), BadRequestException);
    assert.equal(row.status, "DRAFT");
  });

  it("a success without an invoice number is not trusted: ISSUING, for a check", async () => {
    const { service, row } = harness({
      response: { successful: true, pdf: Buffer.from("x") },
    });
    await assert.rejects(
      () => service.issue("invoice-1"),
      ServiceUnavailableException,
    );
    assert.equal(row.status, "ISSUING");
  });

  it("an amount that changed since the draft is refused before any call", async () => {
    const { service, row, sent } = harness({ grossOnDraft: 120000 });
    await assert.rejects(() => service.issue("invoice-1"), ConflictException);
    assert.equal(sent.length, 0);
    assert.equal(row.status, "DRAFT");
  });

  it("an issued invoice is returned as it is, without a call", async () => {
    const { service, sent } = harness({ status: "ISSUED" });
    const summary = await service.issue("invoice-1");
    assert.equal(summary.status, "ISSUED");
    assert.equal(sent.length, 0);
  });

  it("an issued invoice whose PDF could not be saved keeps its number, and never serves the preview", async () => {
    const { service, row } = harness({ putError: new Error("disk full") });
    const summary = await service.issue("invoice-1");
    assert.equal(summary.invoiceNumber, "ACRS-2026-1");
    assert.equal(row.status, "ISSUED");
    assert.equal(row.pdfStorageKey, null);
    await assert.rejects(
      () => service.pdfFor("invoice-1"),
      ServiceUnavailableException,
    );
  });
});
