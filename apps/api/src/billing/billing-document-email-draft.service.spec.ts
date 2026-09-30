import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import { DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE } from "../notifications/mail/billing-document-mail.content.js";
import type { TicketMailRepository } from "../notifications/mail/ticket-mail.repository.js";
import { BillingDocumentEmailDraftService } from "./billing-document-email-draft.service.js";
import type { BillingDocumentsRepository } from "./billing-documents.repository.js";

function service(
  stored: { subject: string; body: string; bodyHtml: string | null } | null,
  exists = true,
) {
  const asked: string[] = [];
  const documents = {
    find: async () => (exists ? { id: "doc-1" } : null),
  } as unknown as BillingDocumentsRepository;
  const templates = {
    template: async (id: string) => {
      asked.push(id);
      return stored;
    },
  } as unknown as TicketMailRepository;
  return {
    drafts: new BillingDocumentEmailDraftService(documents, templates),
    asked,
  };
}

describe("BillingDocumentEmailDraftService", () => {
  it("opens the drawer with the manual-billing template as edited on the Levelezés page", async () => {
    const { drafts, asked } = service({
      subject: "Számla: {{document_number}}",
      body: "Kedves {{customer_name}}!",
      bodyHtml: null,
    });
    const draft = await drafts.draft("doc-1");
    assert.deepEqual(asked, ["BILLING_DOCUMENT_MANUAL"]);
    assert.deepEqual(
      [draft.source, draft.subject, draft.body],
      ["stored", "Számla: {{document_number}}", "Kedves {{customer_name}}!"],
    );
    assert.ok(draft.variables.some((v) => v.name === "document_link"));
  });

  it("falls back to the default text while nobody has edited it", async () => {
    const draft = await service(null).drafts.draft("doc-1");
    assert.deepEqual(
      [draft.source, draft.subject, draft.body],
      [
        "default",
        DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE.subject,
        DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE.body,
      ],
    );
  });

  it("does not find a document outside the module", async () => {
    await assert.rejects(
      service(null, false).drafts.draft("doc-1"),
      NotFoundException,
    );
  });
});
