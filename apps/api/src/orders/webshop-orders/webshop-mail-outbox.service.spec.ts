import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopMailOutboxService } from "./webshop-mail-outbox.service.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

const STUCK = {
  id: "wmout_1",
  template: "order-shipped",
  display_id: 38,
  resource_id: "order_38",
  to: "vevo@example.hu",
  attempts: 1,
  failure_kind: "permanent" as const,
  last_error:
    "A(z) WEBSHOP_ORDER_SHIPPED sablonban ismeretlen változó áll: {{x}}.",
  created_at: "2026-10-05T20:00:00.000Z",
  next_attempt_at: null,
  alerted_at: "2026-10-05T20:00:01.000Z",
};

const service = (client: Partial<MedusaAdminClient>) =>
  new WebshopMailOutboxService({
    adminClient: async () => client as MedusaAdminClient,
  } as unknown as WebshopOrdersService);

describe("the webshop's stuck mails, through the admin client", () => {
  /* the exact request the webshop's W2 endpoint accepts (murena 26562, 26565) */
  it("asks for stuck mails with the page, and posts the retry", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      return new Response(
        JSON.stringify(
          url.includes("retry") ? STUCK : { items: [STUCK], count: 1 },
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    const client = new HttpMedusaAdminClient(
      { baseUrl: "https://shop.test", apiKey: "k" },
      fetchImpl,
    );
    assert.deepEqual(await client.stuckMails({ limit: 50, offset: 0 }), {
      items: [STUCK],
      count: 1,
    });
    assert.deepEqual(await client.retryStuckMail("wmout_1"), STUCK);
    assert.deepEqual(calls, [
      {
        url: "https://shop.test/admin/webshop-mail/outbox?stuck=true&limit=50&offset=0",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://shop.test/admin/webshop-mail/outbox/wmout_1/retry",
        method: "POST",
        body: "{}",
      },
    ]);
  });

  it("passes the page through", async () => {
    let page: unknown;
    await service({
      stuckMails: async (p) => ((page = p), { items: [], count: 0 }),
    }).stuck(50);
    assert.deepEqual(page, { limit: 50, offset: 50 });
  });

  it("a refused list is 'not readable now', a 404 too (no queue yet)", async () => {
    await assert.rejects(
      service({
        stuckMails: async () => {
          throw new MedusaAdminHttpError(
            404,
            "Cannot GET /admin/webshop-mail/outbox",
          );
        },
      }).stuck(),
      (e: unknown) =>
        e instanceof ServiceUnavailableException &&
        e.message === "A webshop levél-sora most nem érhető el (HTTP 404).",
    );
  });

  it("404 and 409 carry the webshop's own sentence; anything else is a 503", async () => {
    const failing = (status: number, body: string) =>
      service({
        retryStuckMail: async () => {
          throw new MedusaAdminHttpError(status, body);
        },
      }).retry("wmout_1");
    await assert.rejects(
      failing(
        404,
        JSON.stringify({
          message: "Nincs ilyen levél a webshop levél-sorában.",
        }),
      ),
      (e: unknown) =>
        e instanceof NotFoundException &&
        e.message === "Nincs ilyen levél a webshop levél-sorában.",
    );
    await assert.rejects(
      failing(
        409,
        JSON.stringify({
          message: "Ez a levél már kiment, nem kell újra sorba tenni.",
        }),
      ),
      (e: unknown) =>
        e instanceof ConflictException &&
        e.message === "Ez a levél már kiment, nem kell újra sorba tenni.",
    );
    await assert.rejects(
      failing(502, "bad gateway"),
      (e: unknown) =>
        e instanceof ServiceUnavailableException &&
        e.message === "A webshop levél-sora most nem érhető el (HTTP 502).",
    );
  });
});
