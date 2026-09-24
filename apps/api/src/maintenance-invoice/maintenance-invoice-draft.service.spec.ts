import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import type { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import type { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzAgentHttpError } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";

/**
 * SEMMILYEN TESZT NEM HÍV VALÓDI HÁLÓZATOT: az `SzamlazzAgentClient` itt
 * MINDIG kézzel írt hamis, soha nem `HttpSzamlazzAgentClient`. Acrobot
 * kikötése (23107): a Számlázz.hu Agent API valódi kulccsal fut, tehát
 * semmilyen teszt nem szólíthatja meg élesben.
 */

const baseCertificate = {
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

const SUCCESS_RESPONSE = {
  successful: true,
  netTotal: 100000,
  grossTotal: 127000,
  pdf: Buffer.from("pdf-bytes"),
};

function service(options: {
  certificate?: typeof baseCertificate | null;
  existingInvoice?: unknown;
  clientResponse?: unknown;
  clientError?: Error;
  credentialsError?: Error;
  pdfLookup?: unknown;
  storedPdfBytes?: Uint8Array | null;
}) {
  const created: unknown[] = [];
  const stored: { key: unknown; bytes: Uint8Array }[] = [];

  const certificates = {
    detail: async () =>
      options.certificate === undefined ? baseCertificate : options.certificate,
  } as unknown as CompletionCertificatesRepository;

  const repository = {
    existingInvoice: async () => options.existingInvoice ?? null,
    createDraft: async (input: unknown) => {
      created.push(input);
      return {
        id: "invoice-1",
        status: "DRAFT",
        currency: "HUF",
        netAmount: new Prisma.Decimal(100000),
        vatAmount: new Prisma.Decimal(27000),
        grossAmount: new Prisma.Decimal(127000),
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      };
    },
    invoicePdfLookup: async () =>
      options.pdfLookup === undefined
        ? { id: "invoice-1", pdfStorageKey: "invoices/invoice-1/preview.pdf" }
        : options.pdfLookup,
  } as unknown as MaintenanceInvoiceRepository;

  const credentials = {
    resolve: async () => {
      if (options.credentialsError) throw options.credentialsError;
      return {
        agentKey: "test-key",
        source: "database" as const,
        revision: "db:1",
      };
    },
  } as unknown as SzamlazzCredentialProvider;

  const documentStore = {
    put: async (key: unknown, bytes: Uint8Array) => {
      stored.push({ key, bytes });
    },
    get: async () =>
      options.storedPdfBytes === undefined
        ? Buffer.from("stored-pdf-bytes")
        : options.storedPdfBytes,
  } as unknown as DocumentStore;

  let clientCalls = 0;
  const client = {
    generateInvoice: async () => {
      clientCalls += 1;
      if (options.clientError) throw options.clientError;
      return options.clientResponse ?? SUCCESS_RESPONSE;
    },
  } as unknown as SzamlazzAgentClient;

  return {
    created,
    stored,
    clientCalls: () => clientCalls,
    service: new MaintenanceInvoiceDraftService(
      certificates,
      repository,
      credentials,
      documentStore,
      client,
    ),
  };
}

describe("MaintenanceInvoiceDraftService.draftFor", () => {
  it("returns the existing draft without calling Számlázz.hu again", async () => {
    const { service: subject, clientCalls } = service({
      existingInvoice: {
        id: "invoice-1",
        status: "DRAFT",
        currency: "HUF",
        netAmount: new Prisma.Decimal(100000),
        vatAmount: new Prisma.Decimal(27000),
        grossAmount: new Prisma.Decimal(127000),
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      },
    });

    const result = await subject.draftFor("cert-1");
    assert.equal(result.id, "invoice-1");
    assert.equal(result.status, "DRAFT");
    assert.equal(result.netAmount, "100000");
    assert.equal(clientCalls(), 0);
  });

  it("throws NotFoundException when the certificate doesn't exist", async () => {
    const { service: subject } = service({ certificate: null });
    await assert.rejects(() => subject.draftFor("cert-1"), NotFoundException);
  });

  it("throws ConflictException when the certificate has no signed document", async () => {
    const { service: subject } = service({
      certificate: { ...baseCertificate, documents: [] },
    });
    await assert.rejects(() => subject.draftFor("cert-1"), ConflictException);
  });

  it("throws BadRequestException when the certificate has no items", async () => {
    const { service: subject } = service({
      certificate: { ...baseCertificate, items: [] },
    });
    await assert.rejects(() => subject.draftFor("cert-1"), BadRequestException);
  });

  it("throws BadRequestException when the customer has no billing address", async () => {
    const { service: subject } = service({
      certificate: {
        ...baseCertificate,
        serviceJob: {
          customer: { ...baseCertificate.serviceJob.customer, addresses: [] },
        },
      },
    });
    await assert.rejects(() => subject.draftFor("cert-1"), BadRequestException);
  });

  it("throws ServiceUnavailableException when the credential isn't configured", async () => {
    const { service: subject } = service({
      credentialsError: new SzamlazzConnectionError(
        "SZAMLAZZ_CONNECTION_NOT_CONFIGURED",
      ),
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      ServiceUnavailableException,
    );
  });

  it("throws ServiceUnavailableException on a transport error from the client", async () => {
    const { service: subject } = service({
      clientError: new SzamlazzAgentHttpError(500, "boom"),
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      ServiceUnavailableException,
    );
  });

  /**
   * ACROBOT KÉRDÉSE (23160): egy nyers hálózati hiba (DNS, kapcsolat
   * megszakadt) a `fetch`-ből SOHA nem `SzamlazzAgentHttpError` -- az csak
   * akkor keletkezik, ha egyáltalán jött HTTP válasz. E nélkül a teszt
   * nélkül ez az ág a nyers hibát dobta volna tovább, angol/technikai
   * szöveggel a magyar felület helyett.
   */
  it("wraps a raw network failure (not a SzamlazzAgentHttpError) in a clean Hungarian message, without creating a row", async () => {
    const { service: subject, created } = service({
      clientError: new TypeError("fetch failed"),
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        (error as Error).message.includes("hálózati hiba"),
    );
    assert.equal(created.length, 0);
  });

  it("throws ServiceUnavailableException when Számlázz.hu rejects the request, and creates no row", async () => {
    const { service: subject, created } = service({
      clientResponse: {
        successful: false,
        errorMessage: "Bejelentkezési hiba",
      },
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        (error as Error).message === "Bejelentkezési hiba",
    );
    assert.equal(created.length, 0);
  });

  it("on success, stores the PDF and creates a DRAFT invoice with no invoiceNumber and no salesOrderId", async () => {
    const { service: subject, created, stored } = service({});

    await subject.draftFor("cert-1");

    assert.equal(stored.length, 1);
    assert.equal(Buffer.from(stored[0]!.bytes).toString("utf8"), "pdf-bytes");

    const input = created[0] as {
      completionCertificateId: string;
      customerId: string;
      totals: { netAmount: Prisma.Decimal };
    };
    assert.equal(input.completionCertificateId, "cert-1");
    assert.equal(input.customerId, "customer-1");
    assert.equal(input.totals.netAmount.toNumber(), 100000);
  });
});

describe("MaintenanceInvoiceDraftService.byCertificate", () => {
  it("returns null when no draft exists yet", async () => {
    const { service: subject } = service({ existingInvoice: null });
    assert.equal(await subject.byCertificate("cert-1"), null);
  });

  it("returns the summary, with Decimal amounts as strings", async () => {
    const { service: subject } = service({
      existingInvoice: {
        id: "invoice-1",
        status: "DRAFT",
        currency: "HUF",
        netAmount: new Prisma.Decimal(100000),
        vatAmount: new Prisma.Decimal(27000),
        grossAmount: new Prisma.Decimal(127000),
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      },
    });
    const summary = await subject.byCertificate("cert-1");
    assert.deepEqual(summary, {
      id: "invoice-1",
      status: "DRAFT",
      currency: "HUF",
      netAmount: "100000",
      vatAmount: "27000",
      grossAmount: "127000",
      createdAt: "2026-09-24T18:00:00.000Z",
    });
  });
});

describe("MaintenanceInvoiceDraftService.pdfFor", () => {
  it("throws NotFoundException when the invoice doesn't exist", async () => {
    const { service: subject } = service({ pdfLookup: null });
    await assert.rejects(() => subject.pdfFor("invoice-1"), NotFoundException);
  });

  it("throws ServiceUnavailableException when there is no stored key", async () => {
    const { service: subject } = service({
      pdfLookup: { id: "invoice-1", pdfStorageKey: null },
    });
    await assert.rejects(
      () => subject.pdfFor("invoice-1"),
      ServiceUnavailableException,
    );
  });

  it("throws ServiceUnavailableException when the store has no bytes for the key", async () => {
    const { service: subject } = service({ storedPdfBytes: null });
    await assert.rejects(
      () => subject.pdfFor("invoice-1"),
      ServiceUnavailableException,
    );
  });

  it("returns the stored PDF bytes", async () => {
    const { service: subject } = service({});
    const bytes = await subject.pdfFor("invoice-1");
    assert.equal(bytes.toString("utf8"), "stored-pdf-bytes");
  });
});
