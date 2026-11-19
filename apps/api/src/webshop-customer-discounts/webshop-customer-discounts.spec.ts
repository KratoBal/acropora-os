import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import type { MedusaPromotionRow } from "../webshop-coupons/webshop-coupons.rules.js";
import type { MedusaCustomerDiscountClient } from "./webshop-customer-discounts.client.js";
import {
  customerIdOfCode,
  type MedusaCustomerGroupRow,
  personalCode,
  personalGroupMetadata,
  personalGroupName,
  toCustomerDiscount,
  toMedusaPersonalPromotion,
} from "./webshop-customer-discounts.rules.js";
import { WebshopCustomerDiscountsService } from "./webshop-customer-discounts.service.js";

/*
  A VEVŐNKÉNTI KEDVEZMÉNY (kártya 20713f62). MI PIROSÍT: a promóció nem automatikus, nem a rendelésre szól (a szállításra is
  jutna), vagy nem a vevő saját csoportjára szűr; a kódból nem fejthető vissza a vevő; a lista egy kupont vagy kézi akciót is
  vevői kedvezménynek mutat; a kapcsoló nélküli környezet a webshophoz nyúl; a beállítás meglévő kedvezménynél újat hoz
  létre, vagy újnál nem a csoport-vevő-promóció sorrendben; egy azonos nevű, de nem ennek a vevőnek létrehozott vagy más
  tagot is tartalmazó csoportot újrahasznosít (a kedvezmény másokra is kiterjedne); a kapcsoló egy kupont is átállít.
*/

const CUS = "cus_01JABCDEF123";
const customer = {
  id: CUS,
  email: "vevo@example.test",
  first_name: "Anna",
  last_name: "Teszt",
  company_name: null,
  has_account: true,
};

describe("the shape in the shop", () => {
  it("an automatic percentage on the order, across its lines, for the customer's own group", () => {
    assert.deepEqual(toMedusaPersonalPromotion(CUS, 7, "cusgroup_1"), {
      code: "EGYEDI-CUS_01JABCDEF123",
      type: "standard",
      status: "active",
      is_automatic: true,
      is_tax_inclusive: true,
      application_method: {
        type: "percentage",
        target_type: "order",
        allocation: "across",
        value: 7,
      },
      rules: [
        {
          attribute: "customer.groups.id",
          operator: "eq",
          values: ["cusgroup_1"],
        },
      ],
    });
  });

  it("the code gives the customer back, and only an EGYEDI-CUS_ code does", () => {
    assert.equal(customerIdOfCode(personalCode(CUS)), CUS);
    assert.equal(customerIdOfCode("TAVASZ10"), null);
    assert.equal(customerIdOfCode("EGYEDI-VALAMI"), null);
    assert.equal(customerIdOfCode(null), null);
  });
});

const promo = (over: Partial<MedusaPromotionRow> = {}): MedusaPromotionRow => ({
  id: "promo_p",
  code: personalCode(CUS),
  status: "active",
  is_automatic: true,
  application_method: { type: "percentage", target_type: "order", value: 7 },
  ...over,
});

describe("toCustomerDiscount", () => {
  it("reads a customer discount with the customer's e-mail and name", () => {
    assert.deepEqual(toCustomerDiscount(promo(), new Map([[CUS, customer]])), {
      id: "promo_p",
      customerId: CUS,
      customerEmail: "vevo@example.test",
      customerName: "Teszt Anna",
      percent: 7,
      active: true,
    });
  });
  it("leaves out a coupon, a non-automatic one, and one not on the order", () => {
    assert.equal(
      toCustomerDiscount(promo({ code: "TAVASZ10" }), new Map()),
      null,
    );
    assert.equal(
      toCustomerDiscount(promo({ is_automatic: false }), new Map()),
      null,
    );
    assert.equal(
      toCustomerDiscount(
        promo({
          application_method: {
            type: "percentage",
            target_type: "items",
            value: 7,
          },
        }),
        new Map(),
      ),
      null,
    );
    assert.equal(
      toCustomerDiscount(
        promo({
          application_method: { type: "fixed", target_type: "order", value: 7 },
        }),
        new Map(),
      ),
      null,
    );
  });
});

/** The carrier group as this screen makes it: its name and metadata for CUS, no members yet unless given. */
function ownGroup(
  over: Partial<MedusaCustomerGroupRow> = {},
): MedusaCustomerGroupRow {
  return {
    id: "cusgroup_old",
    name: personalGroupName(CUS),
    metadata: personalGroupMetadata(CUS),
    customers: [],
    ...over,
  };
}

function fakeClient(state: {
  promotions: MedusaPromotionRow[];
  group?: MedusaCustomerGroupRow | null;
}) {
  const calls: string[] = [];
  const client: MedusaCustomerDiscountClient = {
    searchCustomers: async (q) => {
      calls.push(`search:${q}`);
      return [customer];
    },
    getCustomer: async () => {
      calls.push("customer");
      return customer;
    },
    customersByIds: async () => {
      calls.push("customers");
      return [customer];
    },
    findGroupByName: async () => {
      calls.push("findGroup");
      return state.group ?? null;
    },
    createGroup: async () => {
      calls.push("createGroup");
      return { id: "cusgroup_new" };
    },
    addCustomerToGroup: async (groupId) => {
      calls.push(`add:${groupId}`);
    },
    listPromotions: async () => {
      calls.push("list");
      return state.promotions;
    },
    getPromotion: async (id) => {
      calls.push(`get:${id}`);
      return state.promotions.find((p) => p.id === id)!;
    },
    createPromotion: async (body) => {
      calls.push(`create:${body.rules[0]!.values[0]}`);
      return promo({
        application_method: {
          type: "percentage",
          target_type: "order",
          value: body.application_method.value,
        },
      });
    },
    updatePromotion: async (id, body) => {
      calls.push(
        `update:${id}:${body.status}:${body.application_method?.value ?? "-"}`,
      );
      return promo({
        status: body.status,
        application_method: {
          type: "percentage",
          target_type: "order",
          value: body.application_method?.value ?? 7,
        },
      });
    },
  };
  return { client, calls };
}
const service = (
  client: MedusaCustomerDiscountClient,
  env: Record<string, string> = { MEDUSA_WEBSHOP_COUPONS: "true" },
) => new WebshopCustomerDiscountsService(async () => client, env);

describe("the service", () => {
  it("off: every call is 404 and the shop is not asked", async () => {
    const { client, calls } = fakeClient({ promotions: [] });
    const svc = service(client, {});
    await assert.rejects(svc.list(), NotFoundException);
    await assert.rejects(svc.searchCustomers("vevo"), NotFoundException);
    await assert.rejects(
      svc.set({ customerId: CUS, percent: 5 }),
      NotFoundException,
    );
    await assert.rejects(svc.setActive("promo_p", false), NotFoundException);
    assert.deepEqual(calls, []);
  });

  it("a new discount: the group (an existing one by name reused), the customer into it, then the promotion on it", async () => {
    const fresh = fakeClient({ promotions: [] });
    const created = await service(fresh.client).set({
      customerId: CUS,
      percent: 5,
    });
    assert.deepEqual(fresh.calls, [
      "customer",
      "list",
      "findGroup",
      "createGroup",
      "add:cusgroup_new",
      "create:cusgroup_new",
    ]);
    assert.equal(created.percent, 5);
    const halfDone = fakeClient({
      promotions: [],
      group: ownGroup({ customers: [{ id: CUS }] }),
    });
    await service(halfDone.client).set({ customerId: CUS, percent: 5 });
    assert.deepEqual(halfDone.calls, [
      "customer",
      "list",
      "findGroup",
      "add:cusgroup_old",
      "create:cusgroup_old",
    ]);
  });

  it("a group of that name is reused only if it was made for this customer and holds no one else", async () => {
    const emptyOwn = fakeClient({ promotions: [], group: ownGroup() });
    await service(emptyOwn.client).set({ customerId: CUS, percent: 5 });
    assert.deepEqual(emptyOwn.calls.slice(-2), [
      "add:cusgroup_old",
      "create:cusgroup_old",
    ]);
    for (const [label, group] of [
      ["made by hand, no metadata", ownGroup({ metadata: null })],
      [
        "made for another customer",
        ownGroup({ metadata: personalGroupMetadata("cus_01JOTHER00000") }),
      ],
      [
        "another customer in it",
        ownGroup({ customers: [{ id: CUS }, { id: "cus_01JOTHER00000" }] }),
      ],
      ["members not returned", ownGroup({ customers: undefined })],
    ] as const) {
      const { client, calls } = fakeClient({ promotions: [], group });
      await assert.rejects(
        service(client).set({ customerId: CUS, percent: 5 }),
        ConflictException,
        label,
      );
      assert.deepEqual(calls, ["customer", "list", "findGroup"], label);
    }
  });

  it("an existing discount: its percent is updated and it is switched on, no second group or promotion", async () => {
    const { client, calls } = fakeClient({
      promotions: [promo({ status: "inactive" })],
    });
    const updated = await service(client).set({ customerId: CUS, percent: 12 });
    assert.deepEqual(calls, ["customer", "list", "update:promo_p:active:12"]);
    assert.equal(updated.percent, 12);
    assert.equal(updated.active, true);
  });

  it("a bad input stops before the shop; the search wants three characters", async () => {
    const { client, calls } = fakeClient({ promotions: [] });
    await assert.rejects(
      service(client).set({ customerId: "x", percent: 500 }),
      BadRequestException,
    );
    await assert.rejects(
      service(client).searchCustomers("ab"),
      BadRequestException,
    );
    assert.deepEqual(calls, []);
  });

  it("the switch reads first and refuses a coupon; a customer discount is switched", async () => {
    const coupon = {
      ...promo(),
      id: "promo_c",
      code: "TAVASZ10",
      is_automatic: false,
    };
    const { client, calls } = fakeClient({ promotions: [promo(), coupon] });
    await assert.rejects(
      service(client).setActive("promo_c", false),
      NotFoundException,
    );
    assert.deepEqual(calls, ["get:promo_c"]);
    const off = await service(client).setActive("promo_p", false);
    assert.equal(off.active, false);
  });
});
