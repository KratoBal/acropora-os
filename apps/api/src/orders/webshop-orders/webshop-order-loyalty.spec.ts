import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import { HttpException } from "@nestjs/common";

import {
  MedusaAdminHttpError,
  type MedusaLoyalty,
  type MedusaLoyaltyAdjustment,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  WebshopOrderLoyaltyService,
  loyaltyViewOf,
} from "./webshop-order-loyalty.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  THE LOYALTY POINTS ON THE ORDER PAGE (card dfb79916, second slice). WHAT TURNS RED: a guest order showing a zero
  balance instead of "no ledger", or a manual credit reaching the shop for it; a point count the shop would refuse (zero,
  a fraction, over the bound) or a missing reason leaving the OS; the request id not travelling as the shop's
  idempotency key; a retry (the shop answers 200) writing a second audit row; the shop's own sentence for an overdraw or
  an unknown customer not reaching the page; the audit row not naming the balance before the movement.
*/
const USER = {
  id: "user_1",
  email: "k@acropora.hu",
  displayName: "Kiss Márta",
} as AuthenticatedUser;

const ledger = (balance: number): MedusaLoyalty => ({
  customer_id: "cus_1",
  balance,
  entries: [
    {
      id: "loyent_2",
      kind: "adjustment",
      points: 200,
      order_id: null,
      reference: "os:r1",
      reason: "Késedelem miatti jóváírás",
      actor: "user_1",
      created_at: "2026-11-19T00:10:00.000Z",
    },
  ],
});

function setup(
  over: {
    customerId?: string | null;
    created?: boolean;
    balanceAfter?: number;
    fail?: MedusaAdminHttpError;
  } = {},
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const customerId = over.customerId === undefined ? "cus_1" : over.customerId;
  const client = {
    customerLoyalty: async (...args: unknown[]) => {
      calls.push(["read", ...args]);
      if (over.fail && !calls.some((c) => (c as unknown[])[0] === "adjust"))
        throw over.fail;
      return ledger(over.balanceAfter ?? 500);
    },
    adjustCustomerLoyalty: async (input: unknown) => {
      calls.push(["adjust", input]);
      if (over.fail) throw over.fail;
      const adjustment: MedusaLoyaltyAdjustment = {
        balance: over.balanceAfter ?? 500,
        entry: ledger(0).entries[0]!,
      };
      return { created: over.created ?? true, adjustment };
    },
  };
  const orders = {
    source: async () => ({ order: { customer_id: customerId }, status: null }),
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordOrderEdit: async (input: unknown) => {
      audited.push(input);
    },
  } as unknown as WebshopOrdersRepository;
  return {
    service: new WebshopOrderLoyaltyService(orders, repository),
    calls,
    audited,
  };
}

const input = (
  over: Partial<{ points: number; reason: string; requestId: string }> = {},
) => ({
  points: 200,
  reason: "Késedelem miatti jóváírás",
  requestId: "r1",
  ...over,
});

describe("reading the points of an order", () => {
  it("a guest order has no ledger: unavailable, and the shop is not asked", async () => {
    const { service, calls } = setup({ customerId: null });
    assert.deepEqual(await service.read("order_1"), { available: false });
    assert.deepEqual(calls, []);
  });

  it("a registered customer's balance and rows come camel-cased, newest first as the shop gave them", async () => {
    const { service, calls } = setup({ balanceAfter: 500 });
    const view = await service.read("order_1");
    assert.deepEqual(calls[0], ["read", "cus_1", 20]);
    assert.deepEqual(view, loyaltyViewOf(ledger(500)));
    assert.equal(view.available && view.entries[0]!.orderId, null);
    assert.equal(
      view.available && view.entries[0]!.createdAt,
      "2026-11-19T00:10:00.000Z",
    );
  });
});

describe("a manual credit or debit", () => {
  it("sends the customer, the points, the trimmed reason and the request id as the shop's key", async () => {
    const { service, calls } = setup();
    const result = await service.adjust(
      "order_1",
      input({ reason: "  Késedelem miatti jóváírás  " }),
      USER,
    );
    assert.deepEqual(calls[0], [
      "adjust",
      {
        customer_id: "cus_1",
        points: 200,
        reason: "Késedelem miatti jóváírás",
        reference: "os:r1",
      },
    ]);
    assert.equal(result.created, true);
    assert.equal(result.balance, 500);
    assert.equal(result.loyalty.available, true);
  });

  it("writes one audit row naming the balance before the movement", async () => {
    const { service, audited } = setup({ balanceAfter: 500 });
    await service.adjust("order_1", input({ points: 200 }), USER);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_1",
        action: "loyalty-adjusted",
        before: {
          customerId: "cus_1",
          balance: 300,
          points: 200,
          reason: "Késedelem miatti jóváírás",
          entryId: "loyent_2",
        },
      },
    ]);
  });

  it("a retry the shop answers as already stored writes no second audit row", async () => {
    const { service, audited } = setup({ created: false });
    const result = await service.adjust("order_1", input(), USER);
    assert.equal(result.created, false);
    assert.deepEqual(audited, []);
  });

  it("refuses what the shop would refuse, before the shop is asked", async () => {
    for (const bad of [
      input({ points: 0 }),
      input({ points: 1.5 }),
      input({ points: 10_000_001 }),
      input({ points: -10_000_001 }),
      input({ points: Number.NaN }),
      input({ reason: "   " }),
      input({ reason: "x".repeat(501) }),
    ]) {
      const { service, calls } = setup();
      await assert.rejects(
        () => service.adjust("order_1", bad, USER),
        HttpException,
        JSON.stringify(bad),
      );
      assert.deepEqual(calls, []);
    }
  });

  it("a guest order takes no points", async () => {
    const { service, calls, audited } = setup({ customerId: null });
    await assert.rejects(
      () => service.adjust("order_1", input(), USER),
      /Vendég rendeléshez nincs hűségpont-főkönyv/,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(audited, []);
  });

  it("passes the shop's own sentence for an overdraw and an unknown customer, and writes nothing", async () => {
    const overdraw = new MedusaAdminHttpError(
      409,
      JSON.stringify({
        code: "overdraw",
        message: "A levonás a vevő egyenlege alá menne.",
        balance: 3,
      }),
    );
    const one = setup({ fail: overdraw });
    await assert.rejects(
      () => one.service.adjust("order_1", input({ points: -10 }), USER),
      /egyenlege alá menne/,
    );
    assert.deepEqual(one.audited, []);
    const unknown = new MedusaAdminHttpError(
      404,
      JSON.stringify({ message: "Nincs ilyen vevő." }),
    );
    const two = setup({ fail: unknown });
    await assert.rejects(
      () => two.service.adjust("order_1", input(), USER),
      /Nincs ilyen vevő/,
    );
    assert.deepEqual(two.audited, []);
  });
});
