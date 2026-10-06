import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { methodEditOf } from "./webshop-order-address.rules.js";
import type { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrderShippingMethodService } from "./webshop-order-shipping-method.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  THE SHIPPING METHOD CHANGE FROM THE ORDER PAGE (card 0a14f739 C/2; the
  webshop side is murena's, 26640). WHAT TURNS RED: a change goes out after
  the invoice or the OS parcel, or on a store pickup order; the point is not
  sent with the method, or the target method's points are not asked for; a
  price rise does not send the difference link, or a fall does; a failed
  link takes back a change that already happened; the webshop's refusal
  loses its sentence; an unchanged answer is audited.
*/
const USER = {
  id: "user_1",
  email: "kezelo@acropora.hu",
  displayName: "Kiss Márta",
} as AuthenticatedUser;
const parcel = {
  carrier: "GLS" as const,
  reference: "38",
  parcelNumber: "5000000001",
  stub: false,
  size: null,
  codHuf: null,
  createdAt: "2026-10-05T12:00:00.000Z",
  trackingUrl: null,
};
const OPEN = {
  status: "confirmed" as const,
  invoice: null,
  parcel: null,
  storePickup: false,
};

describe("methodEditOf", () => {
  it("before the invoice and the parcel, on a courier order that is not closed", () => {
    assert.deepEqual(methodEditOf(OPEN), { allowed: true, reason: null });
    const refused = [
      { ...OPEN, status: "closed" as const },
      { ...OPEN, storePickup: true },
      { ...OPEN, status: "out_for_delivery" as const },
      { ...OPEN, parcel },
      {
        ...OPEN,
        invoice: { id: "inv", status: "ISSUED" as const, number: "E-1" },
      },
      {
        ...OPEN,
        invoice: { id: "inv", status: "ISSUING" as const, number: null },
      },
    ];
    for (const input of refused)
      assert.equal(methodEditOf(input).allowed, false);
    assert.match(
      methodEditOf({
        ...OPEN,
        invoice: { id: "inv", status: "ISSUED", number: "E-1" },
      }).reason ?? "",
      /számla sztornója után/,
    );
    // a vázlat még nem számla
    assert.equal(
      methodEditOf({
        ...OPEN,
        invoice: { id: "inv", status: "DRAFT", number: null },
      }).allowed,
      true,
    );
  });
});

function setup(
  over: {
    methodEdit?: WebshopOrderDetail["methodEdit"];
    fail?: MedusaAdminHttpError;
    change?: Partial<{
      changed: boolean;
      difference: number;
      payment_due: boolean;
    }>;
    linkFails?: boolean;
  } = {},
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const links: unknown[] = [];
  const client = {
    orderShippingOptions: async (...args: unknown[]) => {
      calls.push(["options", ...args]);
      if (over.fail) throw over.fail;
      return {
        current_option_id: "so_gls_home",
        options: [
          {
            id: "so_gls_home",
            name: "GLS házhoz",
            amount: "1490",
            carrier: "gls",
            needs_point: false,
            heavy: false,
          },
          {
            id: "so_fox_point",
            name: "Foxpost automata",
            amount: 990,
            carrier: "foxpost",
            needs_point: true,
            heavy: false,
          },
        ],
      };
    },
    orderPickupPoints: async (...args: unknown[]) => {
      calls.push(["points", ...args]);
      return {
        carrier: "foxpost",
        current_point_id: null,
        available: true,
        count: 1,
        pickup_points: [
          {
            id: "F1",
            name: "Foxpost Allee",
            zip: "1117",
            city: "Budapest",
            address: "Október 23. u. 8-10.",
            type: "parcel-locker",
          },
        ],
      };
    },
    changeOrderShippingMethod: async (...args: unknown[]) => {
      calls.push(["method", ...args]);
      if (over.fail) throw over.fail;
      return {
        changed: true,
        previous_total: 20840,
        total: 21340,
        difference: 500,
        payment_due: false,
        payment_state: null,
        ...over.change,
      };
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({
        id,
        methodEdit: over.methodEdit ?? { allowed: true, reason: null },
        shipping: { method: "GLS házhoz", pickupPoint: null },
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
    service: new WebshopOrderShippingMethodService(
      orders,
      repository,
      payments,
    ),
  };
}

describe("WebshopOrderShippingMethodService", () => {
  it("lists the webshop's methods with the new fee, carrier and point need", async () => {
    const { service } = setup();
    assert.deepEqual(await service.options("order_38"), {
      currentOptionId: "so_gls_home",
      options: [
        {
          id: "so_gls_home",
          name: "GLS házhoz",
          amount: 1490,
          carrier: "GLS",
          needsPoint: false,
          heavy: false,
        },
        {
          id: "so_fox_point",
          name: "Foxpost automata",
          amount: 990,
          carrier: "FOXPOST",
          needsPoint: true,
          heavy: false,
        },
      ],
    });
  });

  it("asks for the TARGET method's points", async () => {
    const { calls, service } = setup();
    const answer = await service.points("order_38", "so_fox_point", " allee ");
    assert.deepEqual(calls, [
      ["points", "order_38", "allee", 20, "so_fox_point"],
    ]);
    assert.equal(answer.carrier, "FOXPOST");
    assert.equal(
      answer.points[0]?.address,
      "1117 Budapest, Október 23. u. 8-10.",
    );
  });

  it("a held change never reaches the webshop", async () => {
    const held = setup({
      methodEdit: { allowed: false, reason: "A csomag már fel van adva." },
    });
    await assert.rejects(held.service.options("order_38"), { status: 409 });
    await assert.rejects(held.service.points("order_38", "so", "a"), {
      status: 409,
    });
    await assert.rejects(
      held.service.change("order_38", { optionId: "so" }, USER),
      { status: 409, message: "A csomag már fel van adva." },
    );
    assert.deepEqual(held.calls, []);
  });

  it("a price rise sends the method and point in one step, audits, and sends the difference link", async () => {
    const { calls, audited, links, service } = setup({
      change: { payment_due: true },
    });
    const result = await service.change(
      "order_38",
      { optionId: "so_fox_point", pointId: " F1 " },
      USER,
    );
    assert.deepEqual(calls, [
      [
        "method",
        "order_38",
        {
          shipping_option_id: "so_fox_point",
          point_id: "F1",
          actor: "Kiss Márta",
        },
      ],
    ]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        action: "shipping-method-changed",
        before: { method: "GLS házhoz", pickupPoint: null, total: 20840 },
      },
    ]);
    assert.deepEqual(links, [["order_38", true]]);
    assert.deepEqual(result.change, {
      changed: true,
      previousTotal: 20840,
      total: 21340,
      difference: 500,
      link: { sent: true },
    });
  });

  it("no link when nothing is due; nothing audited when nothing changed", async () => {
    const cheaper = setup({ change: { difference: -500, payment_due: false } });
    const result = await cheaper.service.change(
      "order_38",
      { optionId: "so_gls_home" },
      USER,
    );
    assert.deepEqual(cheaper.links, []);
    assert.equal(result.change.link, null);
    assert.deepEqual(cheaper.calls, [
      [
        "method",
        "order_38",
        { shipping_option_id: "so_gls_home", actor: "Kiss Márta" },
      ],
    ]);
    const same = setup({ change: { changed: false } });
    await same.service.change("order_38", { optionId: "so_gls_home" }, USER);
    assert.deepEqual(same.audited, []);
    assert.deepEqual(same.links, []);
  });

  it("a failed link does not take back the change: it says so", async () => {
    const { audited, service } = setup({
      change: { payment_due: true },
      linkFails: true,
    });
    const result = await service.change(
      "order_38",
      { optionId: "so_fox_point", pointId: "F1" },
      USER,
    );
    assert.equal(audited.length, 1);
    assert.deepEqual(result.change.link, { sent: false, reason: "failed" });
  });

  it("the webshop's own sentence comes through on a refusal", async () => {
    const { audited, service } = setup({
      fail: new MedusaAdminHttpError(
        422,
        JSON.stringify({ message: "Ehhez a módhoz csomagpont kell." }),
      ),
    });
    await assert.rejects(
      service.change("order_38", { optionId: "so_fox_point" }, USER),
      { status: 422, message: "Ehhez a módhoz csomagpont kell." },
    );
    assert.deepEqual(audited, []);
  });
});

describe("the method calls, as sent", () => {
  it("options, target points and the change go to the routes commerce serves", async () => {
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
    await client.orderShippingOptions("order_38");
    await client.orderPickupPoints("order_38", "allee", 20, "so_fox_point");
    await client.changeOrderShippingMethod("order_38", {
      shipping_option_id: "so_fox_point",
      point_id: "F1",
      actor: "Kiss Márta",
    });
    assert.deepEqual(sent, [
      {
        url: "https://shop.test/admin/order-shipping/order_38/options",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://shop.test/admin/order-shipping/order_38/points?q=allee&limit=20&option_id=so_fox_point",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://shop.test/admin/order-shipping/order_38/method",
        method: "POST",
        body: JSON.stringify({
          shipping_option_id: "so_fox_point",
          point_id: "F1",
          actor: "Kiss Márta",
        }),
      },
    ]);
  });
});
