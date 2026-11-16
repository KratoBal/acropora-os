import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import type {
  AuthenticatedUser,
  BillingIssueConfirmation,
  MaintenanceInvoiceSummary,
} from "@acropora/types";

import type { BillingDocumentEmailDraftService } from "../billing/billing-document-email-draft.service.js";
import type { BillingDocumentEmailService } from "../billing/billing-document-email.service.js";
import type { BillingDocumentsService } from "../billing/billing-documents.service.js";
import type { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import { MaintenanceInvoiceIssueService } from "./maintenance-invoice-issue.service.js";

/**
 * "ELKÜLDÖM E-MAILBEN" ON THE TIG INVOICE (card 7ba97e0d, S3; Balázs 2026-11-11 11:20 UTC). WHAT TURNS IT RED: the
 * letter goes to another address than the window's; a missing address is found only after the invoice is issued; an
 * unchecked box still sends; a failed letter fails the request, though the invoice is issued (barracuda on #2419).
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const NOW = new Date("2026-11-11T09:00:00Z");
const CONFIRMED: BillingIssueConfirmation = {
  issueDate: "2026-11-11",
  fulfillmentDate: "2026-11-01",
  dueDate: "2026-11-19",
  fingerprint: "f".repeat(64),
};
const ISSUED = {
  id: "invoice-1",
  status: "ISSUED",
  invoiceNumber: "ACRS-2026-1",
} as MaintenanceInvoiceSummary;

function setup(options: { address?: string | null; sendError?: Error } = {}) {
  const calls = {
    summary: 0,
    issued: [] as unknown[][],
    sent: [] as Array<{ id: string; input: Record<string, unknown> }>,
  };
  const invoices = {
    issueSummary: async () => {
      calls.summary++;
      return {
        buyerEmail:
          options.address === undefined
            ? "szamla@allatkert.example"
            : options.address,
      };
    },
    issue: async (...args: unknown[]) => {
      calls.issued.push(args);
      return ISSUED;
    },
  } as unknown as MaintenanceInvoiceDraftService;
  const documents = {
    detail: async () => ({ emailStatus: null }),
  } as unknown as BillingDocumentsService;
  const email = {
    send: async (id: string, input: Record<string, unknown>) => {
      if (options.sendError) throw options.sendError;
      calls.sent.push({ id, input });
    },
  } as unknown as BillingDocumentEmailService;
  const drafts = {
    templateDraft: async () => ({
      subject: "Számla {document_number}",
      body: "Kedves {customer_name}!",
      bodyHtml: null,
    }),
  } as unknown as BillingDocumentEmailDraftService;
  return {
    service: new MaintenanceInvoiceIssueService(
      invoices,
      documents,
      email,
      drafts,
    ),
    calls,
  };
}

describe("MaintenanceInvoiceIssueService (card 7ba97e0d, S3)", () => {
  it("unchecked: the confirmation reaches the issue, and nothing is sent", async () => {
    const { service, calls } = setup();
    const result = await service.issue(
      "invoice-1",
      { ...CONFIRMED, send: false },
      USER,
      NOW,
    );
    assert.deepEqual(result, { invoice: ISSUED, mail: null });
    assert.deepEqual(calls.issued, [
      ["invoice-1", { ...CONFIRMED, send: false }, NOW],
    ]);
    assert.equal(calls.sent.length, 0);
  });

  it("checked: after the issue the invoice goes to the window's address, with the Levelezés template", async () => {
    const { service, calls } = setup();
    const result = await service.issue(
      "invoice-1",
      { ...CONFIRMED, send: true },
      USER,
      NOW,
    );
    assert.deepEqual(result.mail, {
      to: "szamla@allatkert.example",
      sent: true,
    });
    assert.equal(calls.sent.length, 1);
    const { id, input } = calls.sent[0]!;
    assert.equal(id, "invoice-1");
    assert.deepEqual(
      [input.mode, input.to, input.cc, input.subject],
      ["SEND", ["szamla@allatkert.example"], [], "Számla {document_number}"],
    );
  });

  it("checked with no address: refused before the issue", async () => {
    const { service, calls } = setup({ address: null });
    await assert.rejects(
      () => service.issue("invoice-1", { ...CONFIRMED, send: true }, USER, NOW),
      ConflictException,
    );
    assert.equal(calls.issued.length, 0);
  });

  it("a letter that fails after the issue answers with the issued invoice and the reason, not an error", async () => {
    const { service, calls } = setup({
      sendError: new Error("A levélküldés ki van kapcsolva."),
    });
    const result = await service.issue(
      "invoice-1",
      { ...CONFIRMED, send: true },
      USER,
      NOW,
    );
    assert.equal(calls.issued.length, 1);
    assert.deepEqual(result, {
      invoice: ISSUED,
      mail: {
        to: "szamla@allatkert.example",
        sent: false,
        error: "A levélküldés ki van kapcsolva.",
      },
    });
  });
});
