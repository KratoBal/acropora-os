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
import { budapestDayKey } from "../dashboard/budapest-day.js";
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
  certificate?: unknown;
  partnerTerms?: {
    name: string;
    taxNumber: string | null;
    paymentDueDays: number;
  }[];
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
    partnerPaymentTerms: async () => options.partnerTerms ?? [],
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
      detail: async () => options.certificate ?? certificate,
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

describe("MaintenanceInvoiceDraftService.issue, a fizetési határidő kezdőpontja", () => {
  /**
   * THE DUE DATE STARTS FROM THE INVOICE'S DAY (Balázs, 2026-11-10 10:39 UTC, card 27d12a67): the TIG here is dated 2026-09-24, long
   * before the request, so a due date counted from the TIG (2026-10-02 for the default 8 days) would be in the past. The request's day is
   * read from the real clock around the call (a midnight in between is allowed for, both days are accepted).
   */
  const plusDays = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const dueTag = (xml: string) =>
    /<fizetesiHataridoDatum>([^<]+)<\/fizetesiHataridoDatum>/.exec(xml)?.[1];
  const fulfilmentTag = (xml: string) =>
    /<teljesitesDatum>([^<]+)<\/teljesitesDatum>/.exec(xml)?.[1];

  it("the real issue counts the term from the day of the request (the invoice's date), not from the TIG's date", async () => {
    const { service, sent } = harness({});
    const before = budapestDayKey(new Date());
    await service.issue("invoice-1");
    const after = budapestDayKey(new Date());
    const due = dueTag(sent[0]!);
    assert.ok(
      [plusDays(before, 8), plusDays(after, 8)].includes(due ?? ""),
      `due ${due}`,
    );
    assert.notEqual(due, "2026-10-02");
    assert.equal(fulfilmentTag(sent[0]!), "2026-09-24");
  });

  it("the real issue too: an empty customer row takes the days the Partnerek page holds for the company (30), not 8", async () => {
    const customer = certificate.serviceJob.customer;
    const { service, sent } = harness({
      partnerTerms: [
        {
          name: customer.displayName,
          taxNumber: customer.taxNumber,
          paymentDueDays: 30,
        },
      ],
    });
    const before = budapestDayKey(new Date());
    await service.issue("invoice-1");
    const after = budapestDayKey(new Date());
    assert.ok(
      [plusDays(before, 30), plusDays(after, 30)].includes(
        dueTag(sent[0]!) ?? "",
      ),
    );
  });

  it("the partner's own days count from the request's day: 30 days, 15 days", async () => {
    for (const days of [30, 15]) {
      const withTerm = {
        ...certificate,
        serviceJob: {
          customer: {
            ...certificate.serviceJob.customer,
            paymentDueDays: days,
          },
        },
      };
      const { service, sent } = harness({ certificate: withTerm });
      const before = budapestDayKey(new Date());
      await service.issue("invoice-1");
      const after = budapestDayKey(new Date());
      assert.ok(
        [plusDays(before, days), plusDays(after, days)].includes(
          dueTag(sent[0]!) ?? "",
        ),
        `${days} days`,
      );
    }
  });
});

describe("MaintenanceInvoiceDraftService.issue", () => {
  // the order TIG's draft was confirmed without a signed copy (draftFor): the issue does not
  // ask again; a worksheet TIG still needs its signed copy (Balázs, 2026-11-04 17:38 UTC)
  it("issues an unsigned order TIG's draft; refuses an unsigned worksheet TIG", async () => {
    const order = harness({
      certificate: {
        ...certificate,
        serviceJob: null,
        partnerOrder: {
          orderNumber: "MR-2026-0042",
          customer: certificate.serviceJob.customer,
        },
        documents: [],
      },
    });
    await order.service.issue("invoice-1");
    assert.equal(order.sent.length, 1);
    const worksheet = harness({
      certificate: { ...certificate, documents: [] },
    });
    await assert.rejects(
      () => worksheet.service.issue("invoice-1"),
      ConflictException,
    );
    assert.equal(worksheet.sent.length, 0);
  });

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

/**
 * THE TIG INVOICE'S CONFIRMATION WINDOW (card 7ba97e0d, S3; Balázs 2026-11-11 11:12-11:20 UTC). WHAT TURNS IT RED: the
 * window shows a buyer, a date or an address the issue does not send; a buyer changed after the window opened is issued
 * anyway; a future issue date reaches Számlázz.hu; the confirmed dates do not reach the request or the stored row.
 */
describe("MaintenanceInvoiceDraftService, the confirmation window (card 7ba97e0d, S3)", () => {
  const NOW = new Date("2026-11-11T09:00:00Z");
  const tag = (xml: string, name: string) =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;
  const withCustomer = (over: Record<string, unknown>) => ({
    ...certificate,
    serviceJob: {
      customer: { ...certificate.serviceJob.customer, ...over },
    },
  });

  it("the summary is the issue's mapping: buyer, address, tax number, today, the TIG's fulfilment, the computed due date, the billing address to send to", async () => {
    const { service } = harness({
      certificate: withCustomer({
        email: "info@allatkert.example",
        billingEmail: " szamla@allatkert.example ",
      }),
    });
    const summary = await service.issueSummary("invoice-1", NOW);
    assert.deepEqual(
      { ...summary, fingerprint: summary.fingerprint.length },
      {
        buyerName: "Fővárosi Állatkert",
        buyerAddress: "1146 Budapest, Állatkerti körút 6-12.",
        buyerTaxNumber: "12345678-2-42",
        buyerEuTaxNumber: null,
        buyerEmail: "szamla@allatkert.example",
        issueDate: "2026-11-11",
        fulfillmentDate: "2026-09-24",
        dueDate: "2026-11-19",
        paymentMethod: "Átutalás",
        showsPaymentFields: true,
        dueDateFollowsIssueDate: false,
        fingerprint: 64,
      },
    );
    const ordering = harness({
      certificate: withCustomer({
        email: "info@allatkert.example",
        billingEmail: null,
      }),
    });
    assert.equal(
      (await ordering.service.issueSummary("invoice-1", NOW)).buyerEmail,
      "info@allatkert.example",
    );
  });

  it("an issued invoice has nothing to confirm", async () => {
    await assert.rejects(
      () =>
        harness({ status: "ISSUED" }).service.issueSummary("invoice-1", NOW),
      ConflictException,
    );
  });

  it("the confirmed dates go into the request and the stored row; an earlier issue day is stored at its noon", async () => {
    const { service, sent, row } = harness({});
    const { fingerprint } = await service.issueSummary("invoice-1", NOW);
    await service.issue(
      "invoice-1",
      {
        issueDate: "2026-11-10",
        fulfillmentDate: "2026-11-01",
        dueDate: "2026-11-30",
        fingerprint,
      },
      NOW,
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(
      ["keltDatum", "teljesitesDatum", "fizetesiHataridoDatum"].map((name) =>
        tag(sent[0]!, name),
      ),
      ["2026-11-10", "2026-11-01", "2026-11-30"],
    );
    const stored = row as unknown as Record<string, Date>;
    assert.deepEqual(
      [stored.issueDate, stored.fulfillmentDate, stored.dueDate].map((date) =>
        date!.toISOString(),
      ),
      [
        "2026-11-10T12:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
        "2026-11-30T00:00:00.000Z",
      ],
    );
  });

  it("a buyer changed after the window opened stops the issue, before any call", async () => {
    const changing = withCustomer({});
    const { service, sent } = harness({ certificate: changing });
    const summary = await service.issueSummary("invoice-1", NOW);
    changing.serviceJob.customer.displayName = "Fővárosi Állat- és Növénykert";
    await assert.rejects(
      () =>
        service.issue(
          "invoice-1",
          { ...summary, dueDate: summary.dueDate },
          NOW,
        ),
      /A számla adatai megváltoztak/,
    );
    assert.equal(sent.length, 0);
  });

  it("a future issue date or a due date before it is refused by the shared rule, before any call", async () => {
    const { service, sent } = harness({});
    const { fingerprint } = await service.issueSummary("invoice-1", NOW);
    for (const [dates, error] of [
      [
        {
          issueDate: "2026-11-12",
          fulfillmentDate: "2026-11-01",
          dueDate: "2026-11-30",
        },
        /nem lehet későbbi a mai napnál/,
      ],
      [
        {
          issueDate: "2026-11-11",
          fulfillmentDate: "2026-11-01",
          dueDate: "2026-11-10",
        },
        /nem lehet korábbi a számla kelténél/,
      ],
    ] as const)
      await assert.rejects(
        () => service.issue("invoice-1", { ...dates, fingerprint }, NOW),
        (error_: unknown) =>
          error_ instanceof BadRequestException && error.test(error_.message),
      );
    assert.equal(sent.length, 0);
  });
});

/**
 * WHAT THE INVOICE CARRIES, ON ITS ROW (the 7ba97e0d follow-up): the payment method the request sent, and the buyer as
 * sent. WHAT TURNS IT RED: the issued row keeps no payment method (the billing page showed it empty), or no buyer
 * snapshot (a later edit of the partner rewrote the issued invoice's page).
 */
describe("MaintenanceInvoiceDraftService.issue, the carried payment method and buyer", () => {
  it("stores the request's payment method and the buyer it sent", async () => {
    const { service, row, sent } = harness({
      certificate: {
        ...certificate,
        serviceJob: {
          customer: {
            ...certificate.serviceJob.customer,
            email: "info@allatkert.example",
            billingEmail: "szamla@allatkert.example",
          },
        },
      },
    });
    await service.issue("invoice-1");
    assert.match(sent[0]!, /<fizmod>Átutalás<\/fizmod>/);
    const stored = row as unknown as Record<string, unknown>;
    assert.equal(stored.paymentMethod, "Átutalás");
    assert.deepEqual(stored.buyerSnapshot, {
      name: "Fővárosi Állatkert",
      country: "HU",
      zip: "1146",
      city: "Budapest",
      address: "Állatkerti körút 6-12.",
      taxNumber: "12345678-2-42",
      euTaxNumber: null,
      email: "szamla@allatkert.example",
    });
  });
});
