import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "../integrations/medusa/medusa-admin.client.js";
import type { MedusaCredentialProvider } from "../integrations/medusa/medusa-credential.provider.js";
import { BillingDocumentLanguageService } from "./billing-document-language.service.js";

/*
  WHAT TURNS THIS RED (d5c6befd, P4 follow-up). A document that is not a webshop order's touching the shop; an order
  not marked exactly `en` getting English; an unreadable shop failing the send instead of falling back to
  Hungarian; the log carrying the error's message.
*/
function setup(
  order: { metadata?: Record<string, unknown> | null } | null | Error,
) {
  const asked: string[] = [];
  const credentials = {
    resolve: async () => ({ apiKey: "k" }),
  } as unknown as MedusaCredentialProvider;
  const client = {
    order: async (id: string) => {
      asked.push(id);
      if (order instanceof Error) throw order;
      return order;
    },
  } as unknown as MedusaAdminClient;
  const service = new BillingDocumentLanguageService(credentials, () => client);
  const warnings: string[] = [];
  (service as unknown as { logger: { warn(m: string): void } }).logger = {
    warn: (message: string) => warnings.push(message),
  };
  return { service, asked, warnings };
}

const WEBSHOP = {
  id: "doc-1",
  sourceType: "WEBSHOP_ORDER",
  sourceId: "order_7",
};

describe("BillingDocumentLanguageService", () => {
  it("a webshop order the shop marked English is English, read by the order id", async () => {
    const { service, asked } = setup({
      metadata: { storefront_locale: "en" },
    });
    assert.equal(await service.of(WEBSHOP), "en");
    assert.deepEqual(asked, ["order_7"]);
  });

  it("any other mark, no mark, or no order is Hungarian", async () => {
    for (const order of [
      { metadata: { storefront_locale: "hu" } },
      { metadata: { storefront_locale: "EN" } },
      { metadata: {} },
      { metadata: null },
      null,
    ])
      assert.equal(
        await setup(order).service.of(WEBSHOP),
        "hu",
        JSON.stringify(order),
      );
  });

  it("a document that is not a webshop order's never touches the shop", async () => {
    for (const document of [
      { id: "d", sourceType: "MANUAL", sourceId: "order_7" },
      { id: "d", sourceType: "WEBSHOP_ORDER", sourceId: null },
      { id: "d", sourceType: null, sourceId: null },
      { id: "d" },
    ]) {
      const { service, asked } = setup({
        metadata: { storefront_locale: "en" },
      });
      assert.equal(await service.of(document), "hu", JSON.stringify(document));
      assert.deepEqual(asked, []);
    }
  });

  it("an unreadable shop is Hungarian with a log line that has the document and the error kind only", async () => {
    const { service, warnings } = setup(
      new TypeError("vevo@example.hu secret details"),
    );
    assert.equal(await service.of(WEBSHOP), "hu");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]!.includes("doc-1"));
    assert.ok(warnings[0]!.includes("TypeError"));
    assert.ok(!warnings[0]!.includes("vevo@example.hu"));
    assert.ok(!warnings[0]!.includes("secret details"));
  });
});
