import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ServiceUnavailableException } from "@nestjs/common";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaOrderOverviewRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../../integrations/medusa/medusa-connection.types.js";
import type { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import {
  OVERVIEW_MAX_PAGES,
  OVERVIEW_PAGE_SIZE,
  WebshopOrdersService,
} from "./webshop-orders.service.js";

/*
  A WEBSHOP RENDELÉSLISTA OLVASÁSA. MI PIROSÍT: a lapozás a teljes darabszám
  előtt megáll, vagy utána is kérdez; a körönkénti határnál nem jelez
  `truncated`-et (akkor egy csonka lista teljesnek látszana); a webshop hibája
  vagy a hiányzó kulcs 500-at ad 503 helyett; a számlálók a szűrők után
  számolódnak; a lap nem a kért szelet.
*/
const NOW = new Date("2026-10-05T12:00:00.000Z");
const order = (n: number, status = "confirmed"): MedusaOrderOverviewRow => ({
  id: `order_${n}`,
  display_id: n,
  created_at: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(),
  total: 1000 + n,
  email: `vevo${n}@example.hu`,
  currency_code: "huf",
  customer_name: `Vevő ${n}`,
  phone: null,
  business_status: {
    code: status,
    label: null,
    changed_at: "2026-10-05T11:00:00.000Z",
  },
  shipping_method: n % 2 ? "Foxpost csomagpont" : "Bolti átvétel",
  pickup_point: null,
  payment: null,
  related_order: null,
  customer_signals: {
    is_new_customer: false,
    unsuccessful_closed_order_count: 0,
    has_other_open_order: false,
    purchased_without_registration: false,
  },
});

function service(
  orders: MedusaOrderOverviewRow[],
  options: { fail?: "http" | "credential" } = {},
) {
  const asked: { limit: number; offset: number }[] = [];
  const client = {
    orderOverview: async (page: { limit: number; offset: number }) => {
      asked.push(page);
      if (options.fail === "http")
        throw new MedusaAdminHttpError(502, "bad gateway");
      return {
        orders: orders.slice(page.offset, page.offset + page.limit),
        count: orders.length,
        offset: page.offset,
        limit: page.limit,
      };
    },
  } as unknown as MedusaAdminClient;
  const credentials = {
    resolve: async () => {
      if (options.fail === "credential")
        throw new MedusaConnectionError(
          "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
        );
      return { apiKey: "sk_test", source: "database", revision: "r1" };
    },
  } as unknown as MedusaCredentialProvider;
  return { orders: new WebshopOrdersService(credentials, () => client), asked };
}

describe("WebshopOrdersService.list", () => {
  it("reads pages until the webshop's count, and not one more", async () => {
    const all = Array.from({ length: 150 }, (_, n) => order(n + 1));
    const { orders, asked } = service(all);
    const result = await orders.list({ view: "all", pageSize: 100 }, NOW);
    assert.deepEqual(asked, [
      { limit: OVERVIEW_PAGE_SIZE, offset: 0 },
      { limit: OVERVIEW_PAGE_SIZE, offset: OVERVIEW_PAGE_SIZE },
    ]);
    assert.deepEqual(
      [result.total, result.truncated, result.items.length],
      [150, false, 100],
    );
  });

  it("past the round's limit it says truncated, so a cut list does not look whole", async () => {
    const all = Array.from(
      { length: OVERVIEW_PAGE_SIZE * OVERVIEW_MAX_PAGES + 1 },
      (_, n) => order(n + 1),
    );
    const { orders, asked } = service(all);
    const result = await orders.list({ view: "all" }, NOW);
    assert.equal(asked.length, OVERVIEW_MAX_PAGES);
    assert.equal(result.truncated, true);
  });

  it("the counters follow the view, not the other filters; the page is the asked slice", async () => {
    const all = [
      order(1, "pending_processing"),
      order(2, "confirmed"),
      order(3, "confirmed"),
      order(4, "closed"),
    ];
    const { orders } = service(all);
    const result = await orders.list(
      {
        view: "open",
        status: "pending_processing",
        sort: "displayId",
        direction: "asc",
      },
      NOW,
    );
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["order_1"],
    );
    assert.deepEqual(result.counters, {
      processing: 1,
      invoice: 2,
      dispatch: 0,
      pickup: 0,
      stale: 0,
    });
    assert.deepEqual(result.shippingMethods, [
      "Bolti átvétel",
      "Foxpost csomagpont",
    ]);

    const second = await orders.list(
      {
        view: "all",
        sort: "displayId",
        direction: "asc",
        page: 2,
        pageSize: 3,
      },
      NOW,
    );
    assert.deepEqual(
      [second.items.map((item) => item.id), second.total],
      [["order_4"], 4],
    );
  });

  it("a webshop error or a missing key is 503, with a sentence, not a 500", async () => {
    for (const fail of ["http", "credential"] as const) {
      const { orders } = service([order(1)], { fail });
      await assert.rejects(orders.list({}, NOW), (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.match(String((error as Error).message), /webshop/);
        return true;
      });
    }
  });
});

/*
  AZ ADATLAP OLVASÁSA. MI PIROSÍT: egy nem létező rendelés 500 vagy üres 200
  404 helyett; a vegyes kosár párjának olvasási hibája az egész adatlapot
  elviszi; a párt nem olvassa ki (a link sorszám nélkül marad, holott van);
  a vendég rendelésnél is kérdez a vásárlói számra.
*/
describe("WebshopOrdersService.detail", () => {
  const detailOrder = (
    id: string,
    metadata: Record<string, unknown> | null,
    customer: string | null = "cus_1",
  ) => ({
    id,
    display_id: Number(id.replace(/\D/g, "")),
    created_at: "2026-10-05T10:00:00.000Z",
    email: "x@example.hu",
    currency_code: "huf",
    customer_id: customer,
    metadata,
    total: 1000,
    subtotal: 1000,
    discount_total: 0,
    shipping_total: 0,
    shipping_address: null,
    billing_address: null,
    items: [],
    shipping_methods: [],
    payment_collections: [],
  });

  function detailService(
    options: {
      relatedFails?: boolean;
      missing?: boolean;
      guest?: boolean;
      http?: boolean;
    } = {},
  ) {
    const counted: string[] = [];
    const client = {
      order: async (id: string) => {
        if (options.http) throw new MedusaAdminHttpError(500, "boom");
        if (options.missing && id === "order_38") return null;
        if (id === "order_39") {
          if (options.relatedFails) throw new Error("network");
          return detailOrder("order_39", {
            acropora_parent_order_id: "order_38",
          });
        }
        return detailOrder(
          "order_38",
          { acropora_pickup_order_id: "order_39" },
          options.guest ? null : "cus_1",
        );
      },
      orderBusinessStatus: async () => null,
      countCustomerOrders: async (customerId: string) => {
        counted.push(customerId);
        return 1;
      },
    } as unknown as MedusaAdminClient;
    const credentials = {
      resolve: async () => ({ apiKey: "k", source: "database", revision: "r" }),
    } as unknown as MedusaCredentialProvider;
    return {
      orders: new WebshopOrdersService(credentials, () => client),
      counted,
    };
  }

  it("names the mixed cart's pair by its number, and a failing pair lookup does not take the page", async () => {
    const ok = await detailService().orders.detail("order_38", NOW);
    assert.deepEqual(ok.relatedOrder, {
      id: "order_39",
      displayId: 39,
      role: "pickup",
    });
    const failing = await detailService({ relatedFails: true }).orders.detail(
      "order_38",
      NOW,
    );
    assert.deepEqual(failing.relatedOrder, {
      id: "order_39",
      displayId: null,
      role: "pickup",
    });
  });

  it("an unknown order is 404, a webshop error 503; a guest's order count is not asked", async () => {
    await assert.rejects(
      detailService({ missing: true }).orders.detail("order_38", NOW),
      (error: unknown) => {
        assert.equal(
          (error as { status?: number }).constructor.name,
          "NotFoundException",
        );
        return true;
      },
    );
    await assert.rejects(
      detailService({ http: true }).orders.detail("order_38", NOW),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        return true;
      },
    );
    const guest = detailService({ guest: true });
    const result = await guest.orders.detail("order_38", NOW);
    assert.deepEqual(
      [guest.counted, result.customer.guest, result.customer.isNew],
      [[], true, false],
    );
  });
});
