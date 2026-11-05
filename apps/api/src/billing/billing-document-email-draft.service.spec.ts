import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import {
  DEFAULT_BILLING_DOCUMENT_MANUAL_EN_TEMPLATE,
  DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE,
} from "../notifications/mail/billing-document-mail.content.js";
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
      bodyHtml: "<p>Kedves {{customer_name}}!</p>",
    });
    const draft = await drafts.draft("doc-1");
    assert.equal(draft.bodyHtml, "<p>Kedves {{customer_name}}!</p>");
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

  it("gives the same text without a document, for a letter of an invoice not saved yet", async () => {
    const { drafts, asked } = service(
      {
        subject: "Számla: {{document_number}}",
        body: "Kedves {{customer_name}}!",
        bodyHtml: null,
      },
      false,
    );
    const draft = await drafts.templateDraft();
    assert.deepEqual(asked, ["BILLING_DOCUMENT_MANUAL"]);
    assert.deepEqual(
      [draft.source, draft.subject, draft.body],
      ["stored", "Számla: {{document_number}}", "Kedves {{customer_name}}!"],
    );
  });

  it("does not find a document outside the module", async () => {
    await assert.rejects(
      service(null, false).drafts.draft("doc-1"),
      NotFoundException,
    );
  });

  it("the English twin: its own key, the stored text first and the English default after, never the Hungarian one (d5c6befd, P4)", async () => {
    const stored = await service({
      subject: "Invoice {{document_number}}",
      body: "Dear {{customer_name}}",
      bodyHtml: null,
    }).drafts.templateDraft("en");
    assert.deepEqual(
      [stored.source, stored.subject, stored.body],
      ["stored", "Invoice {{document_number}}", "Dear {{customer_name}}"],
    );
    const { drafts, asked } = service(null);
    const fallback = await drafts.templateDraft("en");
    assert.deepEqual(asked, ["BILLING_DOCUMENT_MANUAL_EN"]);
    assert.deepEqual(
      [fallback.source, fallback.subject, fallback.body],
      [
        "default",
        DEFAULT_BILLING_DOCUMENT_MANUAL_EN_TEMPLATE.subject,
        DEFAULT_BILLING_DOCUMENT_MANUAL_EN_TEMPLATE.body,
      ],
    );
    assert.notEqual(
      fallback.body,
      DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE.body,
    );
    assert.ok(fallback.variables.some((v) => v.name === "document_number"));
  });

  it("without a language it is the Hungarian manual text, as before", async () => {
    const { drafts, asked } = service(null);
    await drafts.templateDraft();
    assert.deepEqual(asked, ["BILLING_DOCUMENT_MANUAL"]);
  });

  it("the English default says what the Hungarian one says: the same four variables, no legal sentence", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const en = DEFAULT_BILLING_DOCUMENT_MANUAL_EN_TEMPLATE;
    const hu = DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE;
    assert.deepEqual(names(en.subject + en.body), names(hu.subject + hu.body));
    assert.ok(!/[áéíóöőúüű]/i.test(en.subject + en.body));
  });
});
