import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
} from "./medusa-admin.client.js";

/*
  THE TWO LOYALTY CALLS TO THE SHOP (commerce #808). WHAT TURNS RED: the customer id not path-encoded; the row limit
  missing from the read; the body of a movement not carrying the shop's key (`reference`); a 201 and a 200 (the same
  movement sent again) not told apart; a 404 or 409 not arriving as an HTTP error with the shop's body (the page needs its
  sentence).
*/
type Sent = { url: string; method: string; body: unknown };

const clientOf = (status: number, answer: unknown, sent: Sent[]) =>
  new HttpMedusaAdminClient(
    { baseUrl: "https://shop.test", apiKey: "k" },
    (async (url: string, init?: RequestInit) => {
      sent.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(answer), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  );

const entry = {
  id: "loyent_1",
  kind: "adjustment",
  points: 200,
  order_id: null,
  reference: "os:r1",
  reason: "r",
  actor: "u",
  created_at: "2026-11-19T00:00:00.000Z",
};

describe("the loyalty read", () => {
  it("asks for the customer's ledger by encoded id with a row limit", async () => {
    const sent: Sent[] = [];
    const ledger = { customer_id: "cus 1", balance: 5, entries: [] };
    const got = await clientOf(200, ledger, sent).customerLoyalty("cus 1", 7);
    assert.deepEqual(sent, [
      {
        url: "https://shop.test/admin/loyalty/cus%201?limit=7",
        method: "GET",
        body: null,
      },
    ]);
    assert.deepEqual(got, ledger);
  });
});

describe("the manual movement", () => {
  const body = {
    customer_id: "cus_1",
    points: 200,
    reason: "r",
    reference: "os:r1",
  };

  it("posts the movement with its key, and tells a new row (201) from a stored one (200)", async () => {
    const sent: Sent[] = [];
    const answer = { balance: 500, entry };
    const created = await clientOf(201, answer, sent).adjustCustomerLoyalty(
      body,
    );
    const replayed = await clientOf(200, answer, sent).adjustCustomerLoyalty(
      body,
    );
    assert.deepEqual(sent[0], {
      url: "https://shop.test/admin/loyalty/adjustments",
      method: "POST",
      body,
    });
    assert.equal(created.created, true);
    assert.equal(replayed.created, false);
    assert.deepEqual(created.adjustment, answer);
  });

  it("raises the shop's refusal with its body: 409 overdraw and 404 unknown customer", async () => {
    for (const status of [409, 404]) {
      const sent: Sent[] = [];
      const refusal = {
        message: "A levonás a vevő egyenlege alá menne.",
        balance: 3,
      };
      await assert.rejects(
        () => clientOf(status, refusal, sent).adjustCustomerLoyalty(body),
        (error: unknown) =>
          error instanceof MedusaAdminHttpError &&
          error.status === status &&
          error.body.includes("egyenlege alá menne"),
      );
    }
  });
});
