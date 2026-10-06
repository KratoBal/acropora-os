import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { splitIdsOf } from "./webshop-order-detail.rules.js";
import { splitRequestRefusal } from "./webshop-order-lines.rules.js";
import type { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrderSplitService } from "./webshop-order-split.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  THE SPLIT FROM THE ORDER PAGE (card 0a14f739 C/3; the webshop side is
  murena's, 26630 and 26634). WHAT TURNS RED: a split goes out after the
  invoice or the parcel; an empty, unknown, over-quantity or whole-order
  request reaches the webshop; the request id or the actor is not sent (a
  lost answer would split twice); the webshop's 409 loses its sentence; the
  split is read from the mixed-cart keys (whose shared card capture would
  then look for the new order on the original's hold).
*/
const USER = {
  id: "user_1",
  email: "kezelo@acropora.hu",
  displayName: "Kiss Márta",
} as AuthenticatedUser;
const LINES = [
  { id: "item_salt", title: "Reef Salt Pro 20 kg", quantity: 2 },
  { id: "item_pump", title: "Tunze 6040", quantity: 1 },
];

describe("splitIdsOf", () => {
  it("reads the split keys only, never the mixed-cart pair", () => {
    assert.deepEqual(
      splitIdsOf({
        acropora_split_order_ids: ["order_39", "", 7],
        acropora_parent_order_id: "order_1",
      }),
      { from: null, into: ["order_39"] },
    );
    assert.deepEqual(
      splitIdsOf({
        acropora_split_from_order_id: "order_38",
        acropora_pickup_order_id: "order_2",
      }),
      { from: "order_38", into: [] },
    );
    // a vegyes kosár párja önmagában nem bontás
    assert.deepEqual(
      splitIdsOf({
        acropora_pickup_order_id: "order_2",
        acropora_parent_order_id: "order_1",
      }),
      { from: null, into: [] },
    );
    assert.deepEqual(splitIdsOf(null), { from: null, into: [] });
  });
});

describe("splitRequestRefusal", () => {
  it("a part of the order may go; empty, unknown, doubled, out of range or whole may not", () => {
    assert.equal(
      splitRequestRefusal(LINES, [{ itemId: "item_salt", quantity: 1 }]),
      null,
    );
    assert.equal(
      splitRequestRefusal(LINES, [{ itemId: "item_salt", quantity: 2 }]),
      null,
    );
    assert.match(splitRequestRefusal(LINES, []) ?? "", /legalább egy/);
    assert.match(
      splitRequestRefusal(LINES, [{ itemId: "item_x", quantity: 1 }]) ?? "",
      /nincs a rendelésen/,
    );
    assert.match(
      splitRequestRefusal(LINES, [
        { itemId: "item_salt", quantity: 1 },
        { itemId: "item_salt", quantity: 1 },
      ]) ?? "",
      /nincs a rendelésen/,
    );
    for (const quantity of [0, 3, 1.5])
      assert.equal(
        splitRequestRefusal(LINES, [{ itemId: "item_salt", quantity }]),
        "Reef Salt Pro 20 kg: 1 és 2 közötti mennyiség bontható.",
        String(quantity),
      );
    assert.match(
      splitRequestRefusal(LINES, [
        { itemId: "item_salt", quantity: 2 },
        { itemId: "item_pump", quantity: 1 },
      ]) ?? "",
      /nem bontás/,
    );
  });
});

function setup(
  over: {
    splitEdit?: WebshopOrderDetail["splitEdit"];
    fail?: MedusaAdminHttpError;
    paymentState?: string;
    linkFails?: boolean;
  } = {},
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const links: unknown[] = [];
  const client = {
    splitOrder: async (...args: unknown[]) => {
      calls.push(args);
      if (over.fail) throw over.fail;
      return {
        order_id: "order_39",
        display_id: 39,
        parent_order_id: "order_38",
        parent_total: 12000,
        total: 9800,
        payment_state: over.paymentState ?? "none",
      };
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({
        id,
        lines: LINES,
        totals: { total: 21800 },
        splitEdit: over.splitEdit ?? { allowed: true, reason: null },
      }) as unknown as WebshopOrderDetail,
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordOrderEdit: async (input: unknown) => void audited.push(input),
  } as unknown as WebshopOrdersRepository;
  const payments = {
    sendPaymentLink: async (...args: unknown[]) => {
      links.push(args.slice(0, 2));
      if (over.linkFails) throw new Error("webshop down");
      return { order: {}, mail: { sent: true } };
    },
  } as unknown as WebshopOrderPaymentService;
  return {
    calls,
    audited,
    links,
    service: new WebshopOrderSplitService(orders, repository, payments),
  };
}

describe("WebshopOrderSplitService.split", () => {
  it("sends the lines, the actor and the request id, audits, and names the new order", async () => {
    const { calls, audited, links, service } = setup();
    const result = await service.split(
      "order_38",
      {
        lines: [{ itemId: "item_salt", quantity: 1 }],
        requestId: "req-1",
      },
      USER,
    );
    assert.deepEqual(calls, [
      [
        "order_38",
        {
          lines: [{ item_id: "item_salt", quantity: 1 }],
          actor: "Kiss Márta",
          request_id: "req-1",
        },
      ],
    ]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        action: "split",
        before: {
          createdOrderId: "order_39",
          lines: [{ itemId: "item_salt", quantity: 1 }],
          total: 21800,
        },
      },
    ]);
    assert.deepEqual(result.created, {
      id: "order_39",
      displayId: 39,
      total: 9800,
      awaitingPayment: false,
      link: null,
    });
    assert.deepEqual(links, []);
  });

  it("a card order's new part gets its payment link on the existing path (Balázs, „2”)", async () => {
    const { links, service } = setup({ paymentState: "awaiting_payment" });
    const result = await service.split(
      "order_38",
      { lines: [{ itemId: "item_salt", quantity: 1 }], requestId: "r" },
      USER,
    );
    assert.deepEqual(links, [["order_39", true]]);
    assert.equal(result.created.awaitingPayment, true);
    assert.deepEqual(result.created.link, { sent: true });
  });

  it("a failed link does not take back the split: it says so", async () => {
    const { audited, service } = setup({
      paymentState: "awaiting_payment",
      linkFails: true,
    });
    const result = await service.split(
      "order_38",
      { lines: [{ itemId: "item_salt", quantity: 1 }], requestId: "r" },
      USER,
    );
    assert.equal(audited.length, 1);
    assert.deepEqual(result.created.link, { sent: false, reason: "failed" });
  });

  it("a held split or a bad request never reaches the webshop", async () => {
    const held = setup({
      splitEdit: {
        allowed: false,
        reason:
          "A számla már ki van állítva: a tétel csak a számla sztornója után módosítható.",
      },
    });
    await assert.rejects(
      held.service.split(
        "order_38",
        { lines: [{ itemId: "item_salt", quantity: 1 }], requestId: "r" },
        USER,
      ),
      { status: 409, message: /számla már ki van állítva/ },
    );
    const whole = setup();
    await assert.rejects(
      whole.service.split(
        "order_38",
        {
          lines: [
            { itemId: "item_salt", quantity: 2 },
            { itemId: "item_pump", quantity: 1 },
          ],
          requestId: "r",
        },
        USER,
      ),
      { status: 422 },
    );
    assert.deepEqual([...held.calls, ...whole.calls], []);
  });

  it("the webshop's own sentence comes through, and nothing is audited", async () => {
    const { audited, service } = setup({
      fail: new MedusaAdminHttpError(
        409,
        JSON.stringify({
          message: "Kártyás rendelés most nem bontható.",
        }),
      ),
    });
    await assert.rejects(
      service.split(
        "order_38",
        { lines: [{ itemId: "item_salt", quantity: 1 }], requestId: "r" },
        USER,
      ),
      { status: 409, message: "Kártyás rendelés most nem bontható." },
    );
    assert.deepEqual(audited, []);
  });
});

describe("the split call, as sent", () => {
  it("goes to the route commerce serves", async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? "GET", body: init?.body });
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new HttpMedusaAdminClient(
      { baseUrl: "https://shop.test", apiKey: "k" },
      fetchImpl,
    );
    await client.splitOrder("order_38", {
      lines: [{ item_id: "item_salt", quantity: 1 }],
      actor: "Kiss Márta",
      request_id: "req-1",
    });
    assert.deepEqual(sent, [
      {
        url: "https://shop.test/admin/order-split/order_38",
        method: "POST",
        body: JSON.stringify({
          lines: [{ item_id: "item_salt", quantity: 1 }],
          actor: "Kiss Márta",
          request_id: "req-1",
        }),
      },
    ]);
  });
});
