import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  BillingDocumentEmailInput,
} from "@acropora/types";

import { TicketMailError } from "../notifications/mail/gmail-mail.sender.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { BillingDocumentEmailRepository } from "./billing-document-email.repository.js";
import { BillingDocumentEmailService } from "./billing-document-email.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

const USER = { id: "user-1" } as AuthenticatedUser;
const OPEN = {
  TICKET_MAIL_MODE: "live",
  TICKET_MAIL_BILLING_DOCUMENT: "live",
  TICKET_MAIL_REDIRECT_TO: "off",
};
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function row(overrides: Record<string, unknown> = {}): BillingDocumentRow {
  return {
    id: "doc-1",
    status: "ISSUED",
    emailStatus: "PENDING",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    invoiceNumber: "E-ACR-2026-7",
    partnerName: "Partner Kft.",
    customer: null,
    currency: "HUF",
    language: "hu",
    netAmount: new Prisma.Decimal("1000"),
    vatAmount: new Prisma.Decimal("270"),
    grossAmount: new Prisma.Decimal("1270"),
    issueDate: new Date("2026-09-30T10:00:00Z"),
    dueDate: new Date("2026-10-08T00:00:00Z"),
    fulfillmentDate: null,
    paymentMethod: null,
    reference: null,
    note: null,
    sourceType: "MANUAL",
    sourceId: null,
    pdfStorageKey: "invoices/doc-1/billing-document.pdf",
    externalUrl: null,
    buyerSnapshot: {
      name: "Partner Kft.",
      country: "HU",
      zip: "1011",
      city: "Budapest",
      address: "Fő utca 1.",
      taxNumber: null,
      euTaxNumber: null,
      email: "szamla@partner.hu",
    },
    issueAttemptCount: 1,
    syncError: null,
    lines: [],
    mailDeliveries: [],
    createdAt: new Date("2026-09-30T09:00:00Z"),
    updatedAt: new Date("2026-09-30T10:00:00Z"),
    ...overrides,
  } as unknown as BillingDocumentRow;
}

const input = (
  overrides: Partial<BillingDocumentEmailInput> = {},
): BillingDocumentEmailInput => ({
  requestId: "7d1f3c2e-2f4b-4c1a-9e1d-0a1b2c3d4e5f",
  mode: "SEND",
  to: ["szamla@partner.hu"],
  cc: ["konyveles@partner.hu"],
  bcc: [],
  subject: "Acropora – {document_number}",
  body: "Kedves {customer_name}! Fizetendő: {gross_total}.",
  ...overrides,
});

function setup(
  options: {
    row?: BillingDocumentRow | null;
    env?: NodeJS.ProcessEnv;
    claim?: boolean;
    previous?: { invoiceId: string } | null;
    sendError?: Error;
    sender?: boolean;
  } = {},
) {
  const calls = {
    claim: 0,
    sent: [] as OutgoingMail[],
    finished: [] as Array<Record<string, unknown>>,
  };
  const current = options.row === undefined ? row() : options.row;
  const documents = {
    find: async () => current,
  } as unknown as BillingDocumentsRepository;
  const repository = {
    deliveryByRequestId: async () => options.previous ?? null,
    claim: async () => {
      calls.claim++;
      return options.claim ?? true;
    },
    finish: async (record: Record<string, unknown>) => {
      calls.finished.push(record);
    },
  } as unknown as BillingDocumentEmailRepository;
  const store = { get: async () => PDF } as unknown as DocumentStore;
  const sender: MailSender = {
    send: async (mail) => {
      if (options.sendError) throw options.sendError;
      calls.sent.push(mail);
    },
  };
  const service = new BillingDocumentEmailService(
    documents,
    repository,
    store,
    options.sender === false ? null : sender,
    options.env ?? OPEN,
  );
  return { service, calls };
}

describe("BillingDocumentEmailService", () => {
  it("sends once: the rendered text, the three recipient lists and the stored PDF", async () => {
    const { service, calls } = setup();
    const detail = await service.send("doc-1", input(), USER);
    assert.equal(detail.id, "doc-1");
    assert.equal(calls.claim, 1);
    assert.equal(calls.sent.length, 1);
    const mail = calls.sent[0]!;
    assert.deepEqual(
      [mail.to, mail.cc, mail.bcc],
      [["szamla@partner.hu"], ["konyveles@partner.hu"], []],
    );
    assert.equal(mail.subject, "Acropora – E-ACR-2026-7");
    assert.equal(mail.text, "Kedves Partner Kft.! Fizetendő: 1270\u00a0Ft.");
    assert.deepEqual(
      mail.attachments?.map((a) => [a.filename, a.contentType, a.bytes]),
      [["E-ACR-2026-7.pdf", "application/pdf", PDF]],
    );
    assert.deepEqual(
      [calls.finished[0]!.mode, calls.finished[0]!.outcome],
      ["SEND", "SENT"],
    );
    assert.equal(calls.finished[0]!.previousEmailStatus, "PENDING");
  });

  it("sends a formatted body as cleaned HTML with a text alternative made from it", async () => {
    const { service, calls } = setup();
    await service.send(
      "doc-1",
      input({
        body: "ez nem számít",
        bodyHtml:
          "<p>Kedves <strong>{{customer_name}}</strong>!</p><script>alert(1)</script>",
      }),
      USER,
    );
    const mail = calls.sent[0]!;
    assert.match(mail.html ?? "", /<strong>Partner Kft\.<\/strong>/);
    assert.doesNotMatch(mail.html ?? "", /script/);
    assert.match(mail.text, /Kedves Partner Kft\.!/);
    assert.doesNotMatch(mail.text, /ez nem számít/);
  });

  it("answers a repeated requestId with the document, without sending again", async () => {
    const { service, calls } = setup({ previous: { invoiceId: "doc-1" } });
    await service.send("doc-1", input(), USER);
    assert.deepEqual([calls.claim, calls.sent.length], [0, 0]);
  });

  it("refuses a requestId that belongs to another document", async () => {
    const { service, calls } = setup({ previous: { invoiceId: "doc-2" } });
    await assert.rejects(
      service.send("doc-1", input(), USER),
      ConflictException,
    );
    assert.equal(calls.sent.length, 0);
  });

  it("refuses what is not issued, not sent at all, or already sending, without a claim", async () => {
    for (const overrides of [
      { status: "DRAFT" },
      { documentType: "DELIVERY_NOTE", invoiceFormat: null },
      { emailStatus: "SENDING" },
    ]) {
      const { service, calls } = setup({ row: row(overrides) });
      await assert.rejects(
        service.send("doc-1", input(), USER),
        ConflictException,
        JSON.stringify(overrides),
      );
      assert.deepEqual([calls.claim, calls.sent.length], [0, 0]);
    }
  });

  it("names the mode that fits when the wrong one is asked", async () => {
    const { service } = setup({ row: row({ emailStatus: "SENT" }) });
    await assert.rejects(
      service.send("doc-1", input({ mode: "SEND" }), USER),
      (error: unknown) =>
        error instanceof ConflictException &&
        /újraküldés indítható/.test(error.message),
    );
    const retry = setup({ row: row({ emailStatus: "FAILED" }) });
    await retry.service.send("doc-1", input({ mode: "RETRY" }), USER);
    assert.equal(retry.calls.sent.length, 1);
  });

  it("stops on a bad address or an unresolved variable before claiming anything", async () => {
    for (const overrides of [
      { to: ["nem-cim"] },
      { body: "A {szamlaszam} szám." },
      { subject: "{order_number}" },
    ]) {
      const { service, calls } = setup();
      await assert.rejects(
        service.send("doc-1", input(overrides), USER),
        BadRequestException,
        JSON.stringify(overrides),
      );
      assert.deepEqual([calls.claim, calls.sent.length], [0, 0]);
    }
  });

  it("sends nothing while a mail switch is closed, the redirect is unset, or there is no sender", async () => {
    for (const [env, sender] of [
      [{ ...OPEN, TICKET_MAIL_MODE: "off" }, true],
      [{ ...OPEN, TICKET_MAIL_BILLING_DOCUMENT: undefined }, true],
      [{ ...OPEN, TICKET_MAIL_REDIRECT_TO: undefined }, true],
      [OPEN, false],
    ] as const) {
      const { service, calls } = setup({ env, sender });
      await assert.rejects(
        service.send("doc-1", input(), USER),
        ServiceUnavailableException,
      );
      assert.deepEqual([calls.claim, calls.sent.length], [0, 0]);
    }
  });

  it("does not send when the claim is lost to a parallel request", async () => {
    const { service, calls } = setup({ claim: false });
    await assert.rejects(
      service.send("doc-1", input(), USER),
      ConflictException,
    );
    assert.equal(calls.sent.length, 0);
  });

  it("records a failed send as FAILED, and an unanswered one as INDETERMINATE", async () => {
    const failed = setup({ sendError: new Error("SMTP 550") });
    await assert.rejects(
      failed.service.send("doc-1", input(), USER),
      BadGatewayException,
    );
    assert.equal(failed.calls.finished[0]!.outcome, "FAILED");

    const unknown = setup({
      sendError: new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE"),
    });
    await assert.rejects(
      unknown.service.send("doc-1", input(), USER),
      ServiceUnavailableException,
    );
    assert.equal(unknown.calls.finished[0]!.outcome, "INDETERMINATE");
  });
});
