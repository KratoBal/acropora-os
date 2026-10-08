import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAIL_TEMPLATE_EVENTS, type AuthenticatedUser } from "@acropora/types";

import { DEFAULT_QUOTE_SEND_TEMPLATE } from "../notifications/mail/quote-mail.content.js";
import type { TicketMailRepository } from "../notifications/mail/ticket-mail.repository.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { QuoteMailService, renderQuoteMail } from "./quote-mail.service.js";
import type { QuotesRepository } from "./quotes.repository.js";

const user = {
  id: "u",
  email: "u@example.test",
  displayName: "Kovács Béla",
  role: "ADMIN",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

function service(stored: { subject: string; body: string } | null) {
  const templates = {
    template: async () => (stored ? { ...stored, bodyHtml: null } : null),
  } as unknown as TicketMailRepository;
  const s = new QuoteMailService(
    {} as QuotesRepository,
    templates,
    {} as DocumentStore,
    null,
    {},
  );
  (s as unknown as { database: unknown }).database = {
    quoteVersion: {
      findFirst: async () => ({
        id: "v",
        status: "PUBLISHED",
        versionNumber: 2,
        validUntil: new Date("2026-11-06T00:00:00Z"),
        pdfStorageKey: "v2-abc",
        quote: {
          status: "DRAFT",
          quoteNumber: "AJ-2026-0042",
          title: "Irodai akvárium",
          customer: {
            displayName: "Blue Office Kft.",
            email: "info@blue.test",
          },
        },
      }),
    },
    quoteMailDelivery: { count: async () => 0 },
  };
  return s;
}

describe("the quote mail's draft (#1582 P3)", () => {
  it("fills every variable the QUOTE_SEND event lists", async () => {
    const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === "QUOTE_SEND")!;
    const all = event.variables.map((name) => `{{${name}}}`).join(" | ");
    const draft = await service({ subject: all, body: all }).draft(
      "q",
      "v",
      user,
    );
    assert.doesNotMatch(draft.body, /\{\{/);
    assert.equal(
      draft.body,
      "Blue Office Kft. | AJ-2026-0042 | Irodai akvárium | 2 | 2026.11.06. | Kovács Béla",
    );
    assert.equal(draft.source, "stored");
  });

  it("without a stored text, the built-in one, filled; the customer's address first", async () => {
    const draft = await service(null).draft("q", "v", user);
    assert.equal(draft.source, "default");
    assert.deepEqual(draft.to, ["info@blue.test"]);
    assert.equal(draft.fileName, "AJ-2026-0042-v2.pdf");
    assert.equal(draft.alreadySent, false);
    assert.doesNotMatch(draft.subject + draft.body, /\{\{/);
    assert.match(draft.body, /Tisztelt Blue Office Kft\.!/);
    assert.ok(DEFAULT_QUOTE_SEND_TEMPLATE.body.includes("{{kuldo_neve}}"));
  });

  it("an unknown name stays as typed, so the drawer shows it", () => {
    assert.equal(
      renderQuoteMail("{{ismeretlen}} {{a}}", { a: "x" }),
      "{{ismeretlen}} x",
    );
  });
});
