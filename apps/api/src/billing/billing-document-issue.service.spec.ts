import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

/**
 * A KIÁLLÍTÁS SZOLGÁLTATÁSA, HAMIS SZÁMLÁZZ.HU-VAL. A feltételes foglalást és a
 * sorok visszaírását a valódi adatbázis méri (integrációs spec); ez azt, hogy a
 * szolgáltatás minden kimenetre helyesen dönt, és a Számlázz.hu-t legfeljebb
 * EGYSZER hívja.
 *
 * Mi pirosít: hívás kikapcsolt kapcsolóval; hívás egy kiállított vagy kiállítás
 * alatti bizonylatra; második hívás, ha a foglalás nem sikerült; elutasítás,
 * ami nem ISSUE_FAILED; ismeretlen kimenet, ami nem marad ISSUING-ben; siker,
 * ami nem a kiküldött összegeket és a vevő-snapshotot írja vissza.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const ON = { BILLING_ISSUE_ENABLED: "true" };
const d = (value: string) => new Prisma.Decimal(value);

function row(status = "DRAFT", invoiceFormat = "ELECTRONIC") {
  return {
    id: "doc-1",
    status,
    emailStatus: null,
    invoiceNumber: status === "ISSUED" ? "E-1" : null,
    documentType: "INVOICE",
    invoiceFormat,
    fulfillmentDate: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-08T00:00:00Z"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    reference: null,
    note: null,
    sourceType: "MANUAL",
    sourceId: null,
    netAmount: d("1000"),
    vatAmount: d("270"),
    grossAmount: d("1270"),
    customer: {
      id: "cust-1",
      customerNumber: "C-1",
      displayName: "Kitalált Kft.",
      companyName: null,
      taxNumber: null,
      email: "vevo@example.com",
      addresses: [
        {
          type: "BILLING",
          isDefault: true,
          country: "HU",
          postalCode: "1011",
          city: "Budapest",
          line1: "Fő utca 1.",
          line2: null,
        },
      ],
    },
    lines: [
      {
        id: "line-1",
        position: 0,
        kind: "ITEM",
        parentLineId: null,
        productId: null,
        description: "Munkadíj",
        quantity: d("1"),
        unit: "db",
        unitNet: d("1000"),
        vatRatePercent: d("27"),
        discountPercent: null,
        netAmount: d("1000"),
        vatAmount: d("270"),
        grossAmount: d("1270"),
        comment: null,
      },
    ],
    mailDeliveries: [],
    createdAt: new Date("2026-09-30T10:00:00Z"),
    updatedAt: new Date("2026-09-30T10:00:00Z"),
  } as unknown as BillingDocumentRow;
}

function setup(
  options: {
    status?: string;
    format?: string;
    claim?: boolean;
    env?: NodeJS.ProcessEnv;
    respond?: () => Promise<SzamlazzAgentResponse>;
  } = {},
) {
  const calls = {
    generate: 0,
    claim: 0,
    issued: [] as unknown[],
    failed: [] as string[],
    unknown: [] as string[],
    pdf: [] as unknown[],
  };
  let current = row(options.status, options.format);
  const documents = {
    find: async () => current,
  } as unknown as BillingDocumentsRepository;
  const repository = {
    claim: async () => {
      calls.claim++;
      return options.claim ?? true;
    },
    markIssued: async (input: unknown) => {
      calls.issued.push(input);
      current = row("ISSUED");
    },
    setPdf: async (_id: string, key: string) => calls.pdf.push(key),
    markFailed: async (_id: string, reason: string) => {
      calls.failed.push(reason);
    },
    markOutcomeUnknown: async (_id: string, note: string) => {
      calls.unknown.push(note);
    },
  } as unknown as BillingDocumentIssueRepository;
  const credentials = {
    resolve: async () => ({
      agentKey: "test-key",
      source: "database",
      revision: "db:1",
    }),
  } as unknown as SzamlazzCredentialProvider;
  const store = {
    put: async (key: unknown) => {
      calls.pdf.push(key);
    },
  } as unknown as DocumentStore;
  const client: SzamlazzAgentClient = {
    generateInvoice: async (xml: string) => {
      calls.generate++;
      assert.match(xml, /<sendEmail>false<\/sendEmail>/);
      assert.match(xml, /<szamlaKulsoAzon>doc-1<\/szamlaKulsoAzon>/);
      assert.doesNotMatch(xml, /elonezetpdf/);
      return (
        options.respond?.() ??
        Promise.resolve({
          successful: true,
          invoiceNumber: "E-TEST-2026-1",
          netTotal: 1000,
          grossTotal: 1270,
          pdf: Buffer.from("%PDF-1.4 kiallitott"),
        })
      );
    },
  };
  const service = new BillingDocumentIssueService(
    documents,
    repository,
    credentials,
    store,
    client,
    options.env ?? ON,
  );
  return { service, calls };
}

const issue = (service: BillingDocumentIssueService) =>
  service.issue("doc-1", "2026-09-30T10:00:00.000Z", USER);

describe("BillingDocumentIssueService", () => {
  it("does not call Számlázz.hu while the switch is off", async () => {
    const { service, calls } = setup({ env: {} });
    await assert.rejects(() => issue(service), ConflictException);
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("issues once: the number, the sent amounts, the buyer, the PDF, and an e-invoice waiting to be sent", async () => {
    const { service, calls } = setup();
    const detail = await issue(service);
    assert.equal(calls.generate, 1);
    assert.equal(detail.status, "ISSUED");
    const [issued] = calls.issued as Array<Record<string, unknown>>;
    assert.equal(issued!.invoiceNumber, "E-TEST-2026-1");
    assert.equal(issued!.emailStatus, "PENDING");
    assert.deepEqual(issued!.totals, {
      netAmount: "1000",
      vatAmount: "270",
      grossAmount: "1270",
    });
    assert.deepEqual(issued!.lines, [
      {
        lineId: "line-1",
        netAmount: "1000.00",
        vatAmount: "270.00",
        grossAmount: "1270.00",
      },
    ]);
    assert.equal((issued!.buyer as { zip: string }).zip, "1011");
    assert.equal(calls.pdf.length, 2); // stored, then its key written
  });

  it("marks a paper invoice as not needing an e-mail", async () => {
    const { service, calls } = setup({ format: "PAPER" });
    await issue(service);
    assert.equal(
      (calls.issued[0] as { emailStatus: string }).emailStatus,
      "NOT_REQUIRED",
    );
  });

  it("returns an issued document again without a second call", async () => {
    const { service, calls } = setup({ status: "ISSUED" });
    const detail = await issue(service);
    assert.equal(detail.status, "ISSUED");
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("refuses a document whose issue is already running, and one refused before, without a call", async () => {
    for (const status of ["ISSUING", "ISSUE_FAILED"]) {
      const { service, calls } = setup({ status });
      await assert.rejects(() => issue(service), ConflictException, status);
      assert.equal(calls.generate, 0, status);
    }
  });

  it("makes no call when the claim fails (saved since, or a second click)", async () => {
    const { service, calls } = setup({ claim: false });
    await assert.rejects(() => issue(service), ConflictException);
    assert.equal(calls.generate, 0);
  });

  it("marks a refusal as ISSUE_FAILED with Számlázz.hu's own reason", async () => {
    const { service, calls } = setup({
      respond: async () => ({
        successful: false,
        errorCode: "57",
        errorMessage: "XML beolvasási hiba.",
      }),
    });
    await assert.rejects(() => issue(service), BadRequestException);
    assert.equal(calls.failed.length, 1);
    assert.match(calls.failed[0]!, /57.*XML beolvasási hiba/);
    assert.equal(calls.issued.length, 0);
  });

  it("leaves an unknown outcome ISSUING for a person, and does not retry", async () => {
    const { service, calls } = setup({
      respond: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(() => issue(service), ServiceUnavailableException);
    assert.deepEqual(
      [calls.generate, calls.unknown.length, calls.failed.length],
      [1, 1, 0],
    );
  });

  it("treats a success without a number as unknown, not as issued", async () => {
    const { service, calls } = setup({
      respond: async () => ({ successful: true }),
    });
    await assert.rejects(() => issue(service), ServiceUnavailableException);
    assert.deepEqual([calls.issued.length, calls.unknown.length], [0, 1]);
  });
});
