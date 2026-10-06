import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import {
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  notesEditOf,
  notesOf,
  pointEditOf,
} from "./webshop-order-address.rules.js";
import { WebshopOrderEditsService } from "./webshop-order-edits.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  THE PICKUP POINT AND THE TWO NOTES FROM THE ORDER PAGE (commerce #494 and
  #493). WHAT TURNS RED: a point changes under a parcel the OS already made
  (the webshop cannot see it); a courier note is offered where the checkout
  clears it; a held edit reaches the webshop; the webshop's 409 or 503 reaches
  the page without its own sentence; a note the editor did not touch is sent
  (and cleared); the history does not name who changed the point.
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
};

describe("when the point and the notes may change", () => {
  it("the point: only on a point order, not under a parcel, not when closed", () => {
    assert.deepEqual(
      pointEditOf({ status: "confirmed", parcel: null, hasPoint: true }),
      { allowed: true, reason: null },
    );
    assert.equal(
      pointEditOf({ status: "confirmed", parcel, hasPoint: true }).reason,
      "A csomag már fel van adva erre a pontra: a pont csak a csomag lemondása után cserélhető.",
    );
    assert.equal(
      pointEditOf({ status: "confirmed", parcel: null, hasPoint: false })
        .allowed,
      false,
    );
    assert.equal(
      pointEditOf({ status: "closed", parcel: null, hasPoint: true }).allowed,
      false,
    );
  });

  it("the courier note: home delivery before the parcel only; the customer's until closed", () => {
    const home = notesEditOf({
      status: "confirmed",
      parcel: null,
      hasPoint: false,
      storePickup: false,
    });
    assert.deepEqual(home, {
      customer: { allowed: true, reason: null },
      carrier: { allowed: true, reason: null },
    });
    const point = notesEditOf({
      status: "confirmed",
      parcel: null,
      hasPoint: true,
      storePickup: false,
    });
    assert.deepEqual(point.customer, { allowed: true, reason: null });
    assert.equal(point.carrier.allowed, false);
    assert.equal(
      notesEditOf({
        status: "confirmed",
        parcel: null,
        hasPoint: false,
        storePickup: true,
      }).carrier.reason,
      "Bolti átvételnél nincs szállító.",
    );
    assert.equal(
      notesEditOf({
        status: "confirmed",
        parcel,
        hasPoint: false,
        storePickup: false,
      }).carrier.allowed,
      false,
    );
    assert.equal(
      notesEditOf({
        status: "closed",
        parcel: null,
        hasPoint: false,
        storePickup: false,
      }).customer.allowed,
      false,
    );
  });

  it("the notes are read from the webshop's metadata keys; blank is none", () => {
    assert.deepEqual(
      notesOf({
        acropora_customer_note: "Délután otthon vagyok.",
        acropora_carrier_note: "  ",
      }),
      { customer: "Délután otthon vagyok.", carrier: null },
    );
    assert.deepEqual(notesOf(null), { customer: null, carrier: null });
  });
});

function setup(
  over: {
    pointEdit?: WebshopOrderDetail["pointEdit"];
    notesEdit?: WebshopOrderDetail["notesEdit"];
    fail?: MedusaAdminHttpError;
    changed?: boolean;
  } = {},
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const allowed = { allowed: true, reason: null };
  const client = {
    orderPickupPoints: async (...args: unknown[]) => {
      calls.push(["points", ...args]);
      if (over.fail) throw over.fail;
      return {
        carrier: "gls",
        current_point_id: "S1",
        available: true,
        count: 2,
        pickup_points: [
          {
            id: "S1",
            name: "Mammut",
            zip: "1024",
            city: "Budapest",
            address: "Lövőház u. 2-6.",
            type: "parcel-shop",
            locker_saturation: null,
          },
          {
            id: "L1",
            name: "GLS Automata",
            zip: "1024",
            city: "Budapest",
            address: "Fény u. 1.",
            type: "parcel-locker",
            locker_saturation: "outOfOrder",
          },
        ],
      };
    },
    changeOrderPickupPoint: async (...args: unknown[]) => {
      calls.push(["point", ...args]);
      if (over.fail) throw over.fail;
      return {
        carrier: "gls",
        changed: over.changed ?? true,
        previous_point_id: "S1",
        point: {},
      };
    },
    updateOrderNotes: async (...args: unknown[]) => {
      calls.push(["notes", ...args]);
      if (over.fail) throw over.fail;
      return { customer_note: null, carrier_note: null };
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({
        id,
        pointEdit: over.pointEdit ?? allowed,
        notesEdit: over.notesEdit ?? { customer: allowed, carrier: allowed },
        notes: { customer: "régi", carrier: null },
        shipping: { pickupPoint: { id: "S1", name: "Mammut" } },
      }) as unknown as WebshopOrderDetail,
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordOrderEdit: async (input: unknown) => void audited.push(input),
  } as unknown as WebshopOrdersRepository;
  return {
    calls,
    audited,
    service: new WebshopOrderEditsService(orders, repository),
  };
}

describe("WebshopOrderEditsService: point and notes", () => {
  it("the point list keeps the webshop's order and marks an out-of-order locker", async () => {
    const { calls, service } = setup();
    const answer = await service.pickupPoints("order_38", "  mammut ");
    assert.deepEqual(calls, [["points", "order_38", "mammut", 20]]);
    assert.equal(answer.carrier, "GLS");
    assert.equal(answer.currentPointId, "S1");
    assert.equal(answer.count, 2);
    assert.deepEqual(answer.points[0], {
      id: "S1",
      name: "Mammut",
      address: "1024 Budapest, Lövőház u. 2-6.",
      kind: "parcel-shop",
      variant: null,
      outOfOrder: false,
    });
    assert.equal(answer.points[1]?.outOfOrder, true);
    assert.equal(answer.points[1]?.kind, "parcel-locker");
  });

  it("a held point change never reaches the webshop", async () => {
    const held = setup({
      pointEdit: { allowed: false, reason: "A csomag már fel van adva." },
    });
    await assert.rejects(held.service.pickupPoints("order_38", "a"), {
      status: 409,
      message: "A csomag már fel van adva.",
    });
    await assert.rejects(held.service.changePoint("order_38", "L1", USER), {
      status: 409,
    });
    assert.deepEqual(held.calls, []);
  });

  it("the change names who made it, and is audited only when it changed", async () => {
    const changed = setup();
    await changed.service.changePoint("order_38", "L2", USER);
    assert.deepEqual(changed.calls, [
      ["point", "order_38", { point_id: "L2", actor: "Kiss Márta" }],
    ]);
    assert.deepEqual(changed.audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        action: "pickup-point-changed",
        before: { id: "S1", name: "Mammut" },
      },
    ]);
    const same = setup({ changed: false });
    await same.service.changePoint("order_38", "S1", USER);
    assert.deepEqual(same.audited, []);
  });

  it("the webshop's own sentence comes through: 422 for a point it refuses, 503 for its list", async () => {
    const refused = setup({
      fail: new MedusaAdminHttpError(
        422,
        JSON.stringify({
          message:
            "Ez a csomagpont ehhez a szállítási módhoz most nem választható.",
        }),
      ),
    });
    await assert.rejects(refused.service.changePoint("order_38", "X", USER), {
      status: 422,
      message:
        "Ez a csomagpont ehhez a szállítási módhoz most nem választható.",
    });
    assert.deepEqual(refused.audited, []);
    const down = setup({
      fail: new MedusaAdminHttpError(
        503,
        JSON.stringify({ carrier: "gls", available: false }),
      ),
    });
    await assert.rejects(down.service.pickupPoints("order_38", "a"), {
      status: 503,
      message:
        "A csomagpontok listája most nem érhető el: a webshop nem érhető el (HTTP 503).",
    });
  });

  it("only the note the editor touched is sent; an empty one clears it", async () => {
    const { calls, audited, service } = setup();
    await service.saveNotes("order_38", { carrierNote: "   " }, USER);
    assert.deepEqual(calls, [["notes", "order_38", { carrier_note: null }]]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        action: "notes-edited",
        before: { customer: "régi", carrier: null },
      },
    ]);
  });

  it("a held courier note never reaches the webshop", async () => {
    const held = setup({
      notesEdit: {
        customer: { allowed: true, reason: null },
        carrier: {
          allowed: false,
          reason: "Csomagpontra menő csomagnál a futár nem kap üzenetet.",
        },
      },
    });
    await assert.rejects(
      held.service.saveNotes("order_38", { carrierNote: "Csengess" }, USER),
      {
        status: 409,
        message: "Csomagpontra menő csomagnál a futár nem kap üzenetet.",
      },
    );
    assert.deepEqual(held.calls, []);
  });
});

describe("the commerce calls, as sent", () => {
  it("points, point and notes go to the routes commerce #494 and #493 serve", async () => {
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
    await client.orderPickupPoints("order_38", "mammut", 20);
    await client.changeOrderPickupPoint("order_38", {
      point_id: "L1",
      actor: "Kiss Márta",
    });
    await client.updateOrderNotes("order_38", { carrier_note: null });
    assert.deepEqual(sent, [
      {
        url: "https://shop.test/admin/order-shipping/order_38/points?q=mammut&limit=20",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://shop.test/admin/order-shipping/order_38/point",
        method: "POST",
        body: JSON.stringify({ point_id: "L1", actor: "Kiss Márta" }),
      },
      {
        url: "https://shop.test/admin/order-notes/order_38",
        method: "POST",
        body: JSON.stringify({ carrier_note: null }),
      },
    ]);
  });
});
