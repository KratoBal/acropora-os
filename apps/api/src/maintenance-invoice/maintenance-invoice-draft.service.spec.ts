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
      paymentDueDays: null,
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
  const sentXml: string[] = [];
  const client = {
    generateInvoice: async (xml: string) => {
      clientCalls += 1;
      sentXml.push(xml);
      if (options.clientError) throw options.clientError;
      return options.clientResponse ?? SUCCESS_RESPONSE;
    },
  } as unknown as SzamlazzAgentClient;

  return {
    // the audit goes with the draft, in its transaction (barracuda, #2176)
    audits: () =>
      created.flatMap((input) => {
        const audit = (input as { unsignedAudit?: unknown }).unsignedAudit;
        return audit ? [audit] : [];
      }),
    created,
    stored,
    clientCalls: () => clientCalls,
    sentXml,
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

  /*
    CÉGNEK ADÓSZÁM NÉLKÜL NINCS KARBANTARTÁSI SZÁMLA (kártya aaf4f09d). MI PIROSÍT:
    ha a céges, adószám nélküli vevő piszkozata vagy kiállítása Számlázz.hu-t hív;
    ha a magánszemély vagy a közösségi adószámos cég elakad.
  */
  it("TAX-GATE: a company, an unknown type or a partner mirror without a tax number gets no draft, and Számlázz.hu is not called", async () => {
    for (const extra of [
      { type: "COMPANY", taxNumber: null, euTaxNumber: null, partner: null },
      { type: undefined, taxNumber: null, euTaxNumber: null, partner: null },
      // az állatkert esete: partner-tükör, a típusa itt nem számít (acrobot 42297)
      {
        type: "PERSON",
        taxNumber: null,
        euTaxNumber: null,
        partner: { id: "supplier-zoo" },
      },
    ]) {
      const { service: subject, clientCalls } = service({
        certificate: {
          ...baseCertificate,
          serviceJob: {
            customer: {
              ...baseCertificate.serviceJob.customer,
              ...extra,
            } as unknown as typeof baseCertificate.serviceJob.customer,
          },
        },
      });
      await assert.rejects(
        () => subject.draftFor("cert-1"),
        (error: unknown) =>
          error instanceof BadRequestException &&
          error.message.startsWith("A vevőnek nincs adószáma:"),
        JSON.stringify(extra),
      );
      assert.equal(clientCalls(), 0, JSON.stringify(extra));
    }
  });

  it("TAX-GATE: a person, or a company with an EU tax number, gets its draft", async () => {
    for (const extra of [
      { type: "PERSON", taxNumber: null, euTaxNumber: null, partner: null },
      { type: "COMPANY", taxNumber: null, euTaxNumber: "DE123456789" },
      { type: "COMPANY", taxNumber: "12345678-2-42", euTaxNumber: null },
    ]) {
      const { service: subject, clientCalls } = service({
        certificate: {
          ...baseCertificate,
          serviceJob: {
            customer: {
              ...baseCertificate.serviceJob.customer,
              ...extra,
            } as unknown as typeof baseCertificate.serviceJob.customer,
          },
        },
      });
      await subject.draftFor("cert-1");
      assert.equal(clientCalls(), 1, JSON.stringify(extra));
    }
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

  it("names the blank address part and never calls Számlázz.hu when the billing address is incomplete", async () => {
    const { service: subject, clientCalls } = service({
      certificate: {
        ...baseCertificate,
        serviceJob: {
          customer: {
            ...baseCertificate.serviceJob.customer,
            addresses: [
              {
                line1: "Fő utca 1.",
                line2: null,
                postalCode: "",
                city: "Budapest",
              },
            ],
          },
        },
      },
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("hiányzik: irányítószám"),
    );
    assert.equal(clientCalls(), 0);
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

describe("MaintenanceInvoiceDraftService.draftFor, a megrendelés TIG-je (Megrendelések S3)", () => {
  // MI PIROSÍT: ha a megrendeléses TIG vevőjét nem a megrendelésről veszi (nincs munkalapja)
  const fromOrder = (customer: unknown) =>
    ({
      ...baseCertificate,
      serviceJob: null,
      partnerOrder: { orderNumber: "MR-2026-0042", customer },
    }) as never;

  it("a vevő a megrendelésé, és a piszkozat erre a vevőre készül", async () => {
    const {
      service: subject,
      created,
      sentXml,
    } = service({
      certificate: fromOrder({
        ...baseCertificate.serviceJob.customer,
        id: "customer-po",
      }),
    });
    await subject.draftFor("cert-1");
    assert.equal(
      (created[0] as { customerId: string }).customerId,
      "customer-po",
    );
    // a külső bizonylat megjegyzése a megrendelést nevezi meg, nem karbantartást (barracuda, #2158)
    assert.match(
      sentXml[0]!,
      /<megjegyzes>Teljesítési igazolás: TIG-2026-0007, megrendelés MR-2026-0042<\/megjegyzes>/,
    );
  });

  it("a karbantartási TIG számlája a karbantartási mondatot viseli", async () => {
    const { service: subject, sentXml } = service({});
    await subject.draftFor("cert-1");
    assert.match(
      sentXml[0]!,
      /<megjegyzes>Karbantartási teljesítési igazolás: TIG-2026-0007<\/megjegyzes>/,
    );
  });

  // Balázs, 2026-11-04 17:38 UTC: aláírt TIG nélkül is számlázható, de csak megerősítéssel
  it("aláírt példány nélkül megerősítést kér, megerősítéssel elkészül", async () => {
    const unsigned = () =>
      ({
        ...(fromOrder(baseCertificate.serviceJob.customer) as object),
        documents: [],
      }) as never;
    const first = service({ certificate: unsigned() });
    await assert.rejects(
      () => first.service.draftFor("cert-1"),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("meg kell erősíteni"),
    );
    assert.equal(first.clientCalls(), 0);
    const confirmed = service({ certificate: unsigned() });
    await confirmed.service.draftFor("cert-1", {
      acknowledgeUnsigned: true,
      actor: { id: "user-luca" },
    });
    assert.equal(confirmed.created.length, 1);
    // barracuda (#2172): who confirmed, which certificate, which draft
    assert.deepEqual(confirmed.audits(), [
      { userId: "user-luca", certificateNumber: "TIG-2026-0007" },
    ]);
  });

  it("aláírt példánnyal nincs auditsor", async () => {
    const { service: subject, audits, created } = service({});
    await subject.draftFor("cert-1", { actor: { id: "user-luca" } });
    assert.equal(created.length, 1);
    assert.deepEqual(audits(), []);
  });

  it("a munkalapos TIG szabálya marad: aláírt példány nélkül megerősítéssel sincs piszkozat", async () => {
    const { service: subject, clientCalls } = service({
      certificate: { ...baseCertificate, documents: [] },
    });
    await assert.rejects(
      () => subject.draftFor("cert-1", { acknowledgeUnsigned: true }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("piszkozat-számla enélkül nem készíthető"),
    );
    assert.equal(clientCalls(), 0);
  });

  it("vevő nélküli megrendelésnél a megrendelést nevezi meg, és nem hív Számlázz.hu-t", async () => {
    const { service: subject, clientCalls } = service({
      certificate: fromOrder(null),
    });
    await assert.rejects(
      () => subject.draftFor("cert-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error as Error).message.startsWith("A megrendeléshez nincs vevő"),
    );
    assert.equal(clientCalls(), 0);
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
      // a valódi kiállítás kapcsolója alapból KI (146ccc61)
      issueEnabled: false,
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
