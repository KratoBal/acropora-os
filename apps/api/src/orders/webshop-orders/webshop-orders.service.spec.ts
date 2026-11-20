import "reflect-metadata";

import assert from "node:assert/strict";
import {
  PERSONAL_DELIVERY_REASON,
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  type WebshopStaleThreshold,
} from "@acropora/types";
import { describe, it } from "node:test";

import { ServiceUnavailableException } from "@nestjs/common";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaOrderOverviewRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../../integrations/medusa/medusa-connection.types.js";
import type { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import type { WebshopParcelService } from "../../integrations/carriers/webshop-parcel.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { STORE_PICKUP_METHOD } from "./webshop-orders.rules.js";
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
/** A tárolt küszöbök a hamis repositoryban; teszt állíthatja. */
const thresholdsNow: { list: WebshopStaleThreshold[] } = {
  list: [...WEBSHOP_STALE_THRESHOLD_DEFAULTS],
};
/** A tárolt díjbekérők a hamis repositoryban; teszt állíthatja. */
const proformasNow: { map: Map<string, unknown> } = { map: new Map() };
const receiptsNow: { map: Map<string, unknown> } = { map: new Map() };
const externalsNow: { map: Map<string, unknown> } = { map: new Map() };
/** Az aktív készlethiányok a hamis repositoryban (rendelésenként), és hogy melyik azonosítókra kérdezett a lista. */
const shortagesNow: {
  map: Map<string, { open: number; agreed: number }>;
  asked: string[][];
} = { map: new Map(), asked: [] };
const NO_AUDIT = {
  recordStatusChange: async () => undefined,
  invoices: async () => new Map(),
  staleThresholds: async () => thresholdsNow.list,
  osCustomerByKey: async () => null,
  internalNote: async () => null,
  proformas: async () => proformasNow.map,
  transferReceipts: async () => receiptsNow.map,
  externalInvoices: async () => externalsNow.map,
  activeShortages: async (ids: string[]) => {
    shortagesNow.asked.push([...ids]);
    return shortagesNow.map;
  },
} as unknown as WebshopOrdersRepository;
const NO_PARCELS = {
  activeParcelsFor: async () => ({}),
} as unknown as WebshopParcelService;
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
  return {
    orders: new WebshopOrdersService(
      credentials,
      NO_AUDIT,
      NO_PARCELS,
      () => client,
    ),
    asked,
  };
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
describe("the stored stale thresholds", () => {
  /*
    A BEÁLLÍTOTT KÜSZÖB (a prompt 17. pontja). MI PIROSÍT: a lista az
    alapértéket nézi a beállított helyett; a kikapcsolt státusz mégis jelez;
    a nap egység órának számít.
  */
  it("the list marks stale by the stored value; a switched-off status never", async () => {
    thresholdsNow.list = [
      { status: "pending_processing", value: 1, unit: "HOUR", enabled: true },
      { status: "stocking", value: 1, unit: "HOUR", enabled: false },
      { status: "out_for_delivery", value: 1, unit: "DAY", enabled: true },
      { status: "ready_for_pickup", value: 5, unit: "DAY", enabled: true },
    ];
    try {
      const result = await service([
        order(1, "pending_processing"),
        order(2, "stocking"),
        order(3, "out_for_delivery"),
      ]).orders.list({ view: "all" }, new Date("2026-10-05T12:30:00.000Z"));
      assert.deepEqual(
        result.items.map((item) => [item.status.code, item.status.stale]),
        [
          ["out_for_delivery", false],
          ["stocking", false],
          ["pending_processing", true],
        ],
      );
    } finally {
      thresholdsNow.list = [...WEBSHOP_STALE_THRESHOLD_DEFAULTS];
    }
  });
});

describe("the expired proforma on the list", () => {
  /*
    „LEJÁRT DÍJBEKÉRŐ” (Balázs, 2026-10-06 16:41 UTC: a rendelés ezzel a
    jelöléssel áll a listán). MI PIROSÍT: a jelölés a határidő napján már
    áll; a ki nem állított díjbekérőn is áll; díjbekérő nélkül is áll; a
    lista nem a rendelés saját díjbekérőjét nézi.
  */
  it("marks the order whose issued proforma is past its due day, and only that", async () => {
    const row = (dueDate: string, status = "ISSUED") => ({
      id: `doc_${dueDate}_${status}`,
      status,
      number: "D-1",
      dueDate: new Date(`${dueDate}T10:00:00.000Z`),
      emailStatus: "SENT",
    });
    proformasNow.map = new Map<string, unknown>([
      ["order_1", row("2026-10-04")],
      ["order_2", row("2026-10-05")],
      ["order_3", row("2026-10-04", "ISSUING")],
    ]);
    try {
      const result = await service([
        order(1),
        order(2),
        order(3),
        order(4),
      ]).orders.list({ view: "all" }, NOW);
      assert.deepEqual(
        result.items.map((item) => [item.id, item.proformaExpired]).sort(),
        [
          ["order_1", true],
          ["order_2", false],
          ["order_3", false],
          ["order_4", false],
        ],
      );
    } finally {
      proformasNow.map = new Map();
    }
  });
});

describe("the proforma that was never issued, on the list (P1/6)", () => {
  /*
    „NINCS DÍJBEKÉRŐ”. MI PIROSÍT: ha az előre utalásos, két napja álló, díjbekérő
    nélküli rendelés néma marad; ha egy kiállított díjbekérős rendelés is jelölődik
    (azt a „Lejárt díjbekérő” kezeli); ha egy fiatal rendelés, egy másik fizetési
    módú rendelés vagy egy végállapotú jelölődik; ha a beérkezett utalás mellett
    is áll.
  */
  const pay = (provider: string, status: string) => ({
    provider_id: provider,
    status,
    amount: 1000,
    captured_amount: null,
    refunded_amount: null,
    hold_expires_at: null,
  });
  const transfer = (
    n: number,
    over: Partial<MedusaOrderOverviewRow> = {},
  ): MedusaOrderOverviewRow => ({
    ...order(n),
    created_at: "2026-09-20T10:00:00.000Z",
    payment: pay("pp_acropora_transfer", "pending"),
    ...over,
  });

  it("marks only the old, unpaid transfer order without an issued proforma", async () => {
    proformasNow.map = new Map<string, unknown>([
      [
        "order_2",
        {
          id: "doc_2",
          status: "ISSUED",
          number: "D-2",
          dueDate: new Date("2026-10-30T10:00:00.000Z"),
          emailStatus: "SENT",
        },
      ],
    ]);
    receiptsNow.map = new Map<string, unknown>([["order_6", { id: "r" }]]);
    try {
      const result = await service([
        transfer(1),
        transfer(2),
        transfer(3, { created_at: "2026-10-04T13:00:00.000Z" }),
        transfer(4, {
          payment: pay("pp_stripe_stripe", "authorized"),
        }),
        transfer(5, {
          business_status: {
            code: "closed_unsuccessfully",
            label: null,
            changed_at: "2026-10-04T11:00:00.000Z",
          },
        }),
        transfer(6),
      ]).orders.list({ view: "all" }, NOW);
      assert.deepEqual(
        result.items.map((item) => [item.id, item.proformaMissing]).sort(),
        [
          ["order_1", true],
          ["order_2", false],
          ["order_3", false],
          ["order_4", false],
          ["order_5", false],
          ["order_6", false],
        ],
      );
    } finally {
      proformasNow.map = new Map();
      receiptsNow.map = new Map();
    }
  });
});

describe("a received transfer on the list", () => {
  /*
    „KIFIZETVE” (bb3a6bd5). MI PIROSÍT: a beérkezett utalás nem jelölődik; a
    kifizetett díjbekérő lejártnak látszik; egy másik rendelés is
    kifizetettnek látszik.
  */
  it("marks the paid order, and a paid proforma is no longer expired", async () => {
    proformasNow.map = new Map<string, unknown>([
      [
        "order_1",
        {
          id: "doc_1",
          status: "ISSUED",
          number: "D-1",
          dueDate: new Date("2026-10-01T10:00:00.000Z"),
          emailStatus: "SENT",
        },
      ],
    ]);
    receiptsNow.map = new Map<string, unknown>([["order_1", {}]]);
    try {
      const result = await service([order(1), order(2)]).orders.list(
        { view: "all" },
        NOW,
      );
      assert.deepEqual(
        result.items
          .map((item) => [item.id, item.transferReceived, item.proformaExpired])
          .sort(),
        [
          ["order_1", true, false],
          ["order_2", false, false],
        ],
      );
    } finally {
      proformasNow.map = new Map();
      receiptsNow.map = new Map();
    }
  });
});

describe("the Számlázz.hu invoice of a prepaid order on the list", () => {
  /*
    (bb3a6bd5) MI PIROSÍT: a Számlázz.hu számlája nem lesz a rendelés számlája
    (a csomag a „Számlára vár” sávban ragad); egy ki nem fizetett számla
    kifizetettnek látszik.
  */
  it("its number is the order's invoice, and its own payments say paid", async () => {
    externalsNow.map = new Map<string, unknown>([
      [
        "order_1",
        { id: "ext_1", number: "E-77", link: "ORDER_NUMBER", paid: true },
      ],
      [
        "order_3",
        { id: "ext_3", number: "E-78", link: "BUYER_AMOUNT", paid: false },
      ],
    ]);
    try {
      const result = await service([
        order(1, "stocking"),
        order(2, "stocking"),
        order(3, "stocking"),
      ]).orders.list({ view: "all" }, NOW);
      assert.deepEqual(
        result.items
          .map((item) => [item.id, item.invoiceNumber, item.transferReceived])
          .sort(),
        [
          ["order_1", "E-77", true],
          ["order_2", null, false],
          ["order_3", "E-78", false],
        ],
      );
    } finally {
      externalsNow.map = new Map();
    }
  });
});

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
      split?: boolean;
    } = {},
  ) {
    const counted: string[] = [];
    const client = {
      order: async (id: string) => {
        if (options.http) throw new MedusaAdminHttpError(500, "boom");
        if (options.missing && id === "order_38") return null;
        if (id === "order_40") return detailOrder("order_40", null);
        if (id === "order_41") throw new Error("network");
        if (id === "order_39") {
          if (options.relatedFails) throw new Error("network");
          return detailOrder("order_39", {
            acropora_parent_order_id: "order_38",
          });
        }
        return detailOrder(
          "order_38",
          options.split
            ? {
                acropora_split_from_order_id: "order_40",
                acropora_split_order_ids: ["order_41"],
              }
            : { acropora_pickup_order_id: "order_39" },
          options.guest ? null : "cus_1",
        );
      },
      orderBusinessStatus: async () => null,
      orderPayment: async () => null,
      countCustomerOrders: async (customerId: string) => {
        counted.push(customerId);
        return 1;
      },
    } as unknown as MedusaAdminClient;
    const credentials = {
      resolve: async () => ({ apiKey: "k", source: "database", revision: "r" }),
    } as unknown as MedusaCredentialProvider;
    return {
      orders: new WebshopOrdersService(
        credentials,
        NO_AUDIT,
        NO_PARCELS,
        () => client,
      ),
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

  it("names both ends of a split by number; a failing lookup leaves the link without one", async () => {
    const split = await detailService({ split: true }).orders.detail(
      "order_38",
      NOW,
    );
    assert.deepEqual(split.split, {
      from: { id: "order_40", displayId: 40 },
      into: [{ id: "order_41", displayId: null }],
      unfinished: null,
    });
    assert.equal(split.relatedOrder, null);
    const plain = await detailService().orders.detail("order_38", NOW);
    assert.deepEqual(plain.split, { from: null, into: [], unfinished: null });
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

/*
  A STÁTUSZVÁLTÁS. MI PIROSÍT: egy nem megengedett cél eljut a webshopig
  (egy elavult lapról); a webshop levonási hibája elvész, vagy angolul,
  mondat nélkül jön; a sikertelen váltás is auditsort ír; a sikeres nem írja
  le, KI és honnan hová léptette.
*/
describe("WebshopOrdersService.changeStatus", () => {
  function statusService(
    options: {
      transitionError?: MedusaAdminHttpError;
      resendError?: MedusaAdminHttpError;
      noStatus?: boolean;
      /** The gate's facts: by default the order has an issued invoice and a confirmed parcel, and ships. */
      invoice?: boolean;
      parcel?: boolean;
      storePickup?: boolean;
      /** The override trace: the `requested` row cannot be written / cannot be marked applied. */
      requestError?: boolean;
      markError?: boolean;
    } = {},
  ) {
    const sent: Record<string, unknown>[] = [];
    const audited: unknown[] = [];
    const client = {
      order: async () => ({
        id: "order_38",
        display_id: 38,
        created_at: "2026-10-05T10:00:00.000Z",
        email: "x@example.hu",
        currency_code: "huf",
        customer_id: null,
        metadata: null,
        total: 1000,
        subtotal: 1000,
        discount_total: 0,
        shipping_total: 0,
        shipping_address: null,
        billing_address: null,
        items: [],
        shipping_methods: options.storePickup
          ? [{ name: STORE_PICKUP_METHOD, shipping_option_id: null }]
          : [{ name: "GLS házhozszállítás", shipping_option_id: null }],
        payment_collections: [],
      }),
      orderBusinessStatus: async () =>
        options.noStatus
          ? null
          : {
              order_id: "order_38",
              status: "stocking",
              label: "Készletezés alatt",
              changed_at: "2026-10-05T10:00:00.000Z",
              next_statuses: [
                { status: "out_for_delivery", label: "Kiszállítás" },
                {
                  status: "closed_unsuccessfully",
                  label: "Sikertelenül lezárt rendelés",
                },
              ],
              history: [],
            },
      transitionBusinessStatus: async (
        id: string,
        status: string,
        notify: boolean,
      ) => {
        if (options.transitionError) throw options.transitionError;
        sent.push({ id, status, notify });
        return notify
          ? { sent: false, reason: "mail_off" }
          : { sent: false, reason: "not_requested" };
      },
      resendStatusNotification: async (id: string) => {
        if (options.resendError) throw options.resendError;
        sent.push({ id, resend: true });
        return { sent: true };
      },
      orderPayment: async () => null,
      countCustomerOrders: async () => 0,
    } as unknown as MedusaAdminClient;
    const credentials = {
      resolve: async () => ({ apiKey: "k", source: "database", revision: "r" }),
    } as unknown as MedusaCredentialProvider;
    const repository = {
      recordStatusChange: async (input: unknown) => void audited.push(input),
      requestShippingOverride: async (input: unknown) => {
        if (options.requestError) throw new Error("audit write failed");
        audited.push({ requested: input });
        return "audit_row_1";
      },
      markShippingOverrideApplied: async (rowId: string, input: unknown) => {
        if (options.markError) throw new Error("audit update failed");
        audited.push({ applied: rowId, trace: input });
      },
      recordStatusMailResent: async (input: unknown) =>
        void audited.push(input),
      invoices: async () =>
        options.invoice === false
          ? new Map()
          : new Map([
              [
                "order_38",
                { id: "inv_1", status: "ISSUED", number: "ACRW-2026/00600" },
              ],
            ]),
      staleThresholds: async () => thresholdsNow.list,
      osCustomerByKey: async () => null,
      internalNote: async () => null,
      proformas: async () => new Map(),
      transferReceipts: async () => new Map(),
      externalInvoices: async () => new Map(),
    } as unknown as WebshopOrdersRepository;
    return {
      orders: new WebshopOrdersService(
        credentials,
        repository,
        {
          activeParcelsFor: async () =>
            options.parcel === false
              ? {}
              : {
                  order_38: {
                    carrier: "gls",
                    reference: "38",
                    parcelNumber: "3400000001",
                    carrierParcelId: null,
                    stub: false,
                    size: null,
                    codHuf: null,
                    createdAt: new Date("2026-10-05T11:00:00.000Z"),
                  },
                },
        } as unknown as WebshopParcelService,
        () => client,
      ),
      sent,
      audited,
    };
  }

  it("an allowed step goes to the webshop and the OS records who moved it, from where to where", async () => {
    const { orders, sent, audited } = statusService();
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
    );
    assert.deepEqual(sent, [
      { id: "order_38", status: "out_for_delivery", notify: true },
    ]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        from: "stocking",
        to: "out_for_delivery",
      },
    ]);
    assert.equal(result.order.id, "order_38");
    assert.deepEqual(result.mail, { sent: false, reason: "mail_off" });
  });

  /**
   * A STÁTUSZLEVÉL (commerce #479). MI PIROSÍT: a „Vevő értesítése” jelölő
   * kikapcsolása nem jut el a webshopig; az újraküldés nem kerül auditba,
   * vagy a webshop hibája 500.
   */
  it("an unticked „Vevő értesítése” reaches the webshop as no mail", async () => {
    const { orders, sent } = statusService();
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      false,
      NOW,
    );
    assert.deepEqual(sent, [
      { id: "order_38", status: "out_for_delivery", notify: false },
    ]);
    assert.deepEqual(result.mail, { sent: false, reason: "not_requested" });
  });

  it("a resend goes to the webshop, and who asked is audited with the outcome", async () => {
    const { orders, sent, audited } = statusService();
    const result = await orders.resendStatusMail("order_38", "user_1", NOW);
    assert.deepEqual(sent, [{ id: "order_38", resend: true }]);
    assert.deepEqual(audited, [
      { userId: "user_1", orderId: "order_38", mail: { sent: true } },
    ]);
    assert.deepEqual(result.mail, { sent: true });

    const missing = statusService({
      resendError: new MedusaAdminHttpError(404, "no history"),
    });
    await assert.rejects(
      missing.orders.resendStatusMail("order_38", "user_1", NOW),
      (error: unknown) => {
        assert.equal((error as Error).constructor.name, "NotFoundException");
        return true;
      },
    );
    assert.deepEqual(missing.audited, []);
  });

  it("a step the table does not allow is 409 and never reaches the webshop", async () => {
    const { orders, sent, audited } = statusService();
    await assert.rejects(
      orders.changeStatus("order_38", "closed", "user_1", true, NOW),
      (error: unknown) => {
        assert.equal((error as Error).constructor.name, "ConflictException");
        assert.match(
          (error as Error).message,
          /Készletezés alatt.*Megrendelés lezárva/,
        );
        return true;
      },
    );
    assert.deepEqual([sent, audited], [[], []]);
  });

  /**
   * A KISZÁLLÍTÁS KAPUJA (kártya 33a0d3c7). MI PIROSÍT: ha a Kiszállítás számla vagy csomag nélkül átmegy (a kártyás levonás
   * erre az állapotra fut); ha a 409 nem nevezi meg, mi hiányzik; ha a kérés mégis eljut a webshopig vagy auditba kerül; ha a
   * bolti átvétel vagy egy másik lépés (sikertelen lezárás) elakad rajta; ha egy elavult lap a kapu mondatát kapja a „frissítsd
   * az oldalt” helyett.
   */
  it("shipping needs an issued invoice AND a confirmed parcel: the 409 names what is missing, nothing reaches the webshop or the audit", async () => {
    for (const [options, missing] of [
      [{ invoice: false, parcel: false }, "kiállított számla, feladott csomag"],
      [{ invoice: false }, "kiállított számla"],
      [{ parcel: false }, "feladott csomag"],
    ] as const) {
      const { orders, sent, audited } = statusService(options);
      await assert.rejects(
        orders.changeStatus(
          "order_38",
          "out_for_delivery",
          "user_1",
          true,
          NOW,
        ),
        (error: unknown) => {
          assert.equal((error as Error).constructor.name, "ConflictException");
          assert.match(
            (error as Error).message,
            new RegExp(`Hiányzik: ${missing}\\.`),
          );
          return true;
        },
      );
      assert.deepEqual([sent, audited], [[], []]);
    }
  });

  /*
    A FELÜLBÍRÁLÁS (kártya 33a0d3c7). MI PIROSÍT: ha jog nélkül átmegy; ha indok nélkül átmegy; ha a felülbírált váltás nem hagy külön
    naplósort az indokkal és a hiányzó résszel; ha a jog nélküli vagy indok nélküli kérés eljut a webshopig vagy auditba kerül; ha egy
    nem szükséges felülbírálás is felülbírálásként naplózódik; ha a váltás eredménye nem jelzi, hogy felülbírálással ment.
  */
  it("an override with the right and a reason ships without the invoice and the parcel, and the audit row carries the reason and what was missing", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      parcel: false,
    });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        overrideReason: "  A csomagot a GLS portálján adtuk fel kézzel  ",
        canOverride: true,
      },
    );
    assert.equal(sent.length, 1);
    assert.equal(result.shippingGateOverridden, true);
    const trace = {
      userId: "user_1",
      orderId: "order_38",
      from: "stocking",
      to: "out_for_delivery",
      reason: "A csomagot a GLS portálján adtuk fel kézzel",
      missing: ["kiállított számla", "feladott csomag"],
    };
    assert.deepEqual(audited, [
      { requested: trace },
      { applied: "audit_row_1", trace },
      {
        userId: "user_1",
        orderId: "order_38",
        from: "stocking",
        to: "out_for_delivery",
      },
    ]);
  });

  /*
    A NAPLÓSOR SORRENDJE (barracuda #2724). MI PIROSÍT: ha a `requested` sor a webshop-hívás UTÁN íródik (egy lefutott levonás nyom nélkül maradhat);
    ha a sor hibája mellett a lépés mégis elindul; ha a webshop elutasítása után a sor eltűnik vagy `applied` lesz; ha az `applied`-re állítás
    hibája visszafordítja vagy elbuktatja a már megtörtént váltást.
  */
  it("the requested row is written BEFORE the webshop call: if it cannot be written, nothing is sent", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      requestError: true,
    });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW, {
        overrideReason: "A csomagot a GLS portálján adtuk fel kézzel",
        canOverride: true,
      }),
      /audit write failed/,
    );
    assert.deepEqual([sent, audited], [[], []]);
  });

  it("a webshop refusal leaves the requested row as it is (an attempt's trace), never applied, and no status row", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      transitionError: new MedusaAdminHttpError(
        422,
        JSON.stringify({ message: "A levonás nem sikerült" }),
      ),
    });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW, {
        overrideReason: "A csomagot a GLS portálján adtuk fel kézzel",
        canOverride: true,
      }),
      (error: unknown) =>
        (error as Error).constructor.name === "UnprocessableEntityException",
    );
    assert.equal(sent.length, 0);
    assert.equal(audited.length, 1);
    assert.ok("requested" in (audited[0] as object));
  });

  it("if marking the row applied fails after the webshop accepted, the shipping still stands and the status row is still written", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      markError: true,
    });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        overrideReason: "A csomagot a GLS portálján adtuk fel kézzel",
        canOverride: true,
      },
    );
    assert.equal(sent.length, 1);
    assert.equal(result.shippingGateOverridden, true);
    assert.equal(audited.length, 2);
    assert.ok("requested" in (audited[0] as object));
    assert.equal(
      (audited[1] as { action?: unknown; to?: string }).to,
      "out_for_delivery",
    );
  });

  it("a reason without the right is a 403: nothing reaches the webshop and nothing is audited", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      parcel: false,
    });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW, {
        overrideReason: "A csomagot a GLS portálján adtuk fel kézzel",
        canOverride: false,
      }),
      (error: unknown) =>
        (error as Error).constructor.name === "ForbiddenException",
    );
    assert.deepEqual([sent, audited], [[], []]);
  });

  it("a missing or too short reason is a 400 even with the right: nothing is sent or audited", async () => {
    for (const reason of ["", "   ", "rövid"]) {
      const { orders, sent, audited } = statusService({ invoice: false });
      await assert.rejects(
        orders.changeStatus(
          "order_38",
          "out_for_delivery",
          "user_1",
          true,
          NOW,
          {
            overrideReason: reason,
            canOverride: true,
          },
        ),
        (error: unknown) =>
          (error as Error).constructor.name === "BadRequestException",
        JSON.stringify(reason),
      );
      assert.deepEqual([sent, audited], [[], []]);
    }
  });

  it("without a reason the right alone does not open the gate: it is the 409 as before", async () => {
    const { orders, sent } = statusService({ parcel: false });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW, {
        canOverride: true,
      }),
      (error: unknown) =>
        (error as Error).constructor.name === "ConflictException",
    );
    assert.equal(sent.length, 0);
  });

  it("a reason sent when the gate does not hold is ignored: no override trace, the result says it was not overridden", async () => {
    const { orders, audited } = statusService({ invoice: true, parcel: true });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        overrideReason: "Felesleges indoklás szöveg",
        canOverride: true,
      },
    );
    assert.equal(result.shippingGateOverridden, false);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        from: "stocking",
        to: "out_for_delivery",
      },
    ]);
  });

  it("only the missing part is named in the audit: an issued invoice with no parcel logs 'feladott csomag' only", async () => {
    const { orders, audited } = statusService({ parcel: false });
    await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        overrideReason: "Csomag a portálon feladva, számmal",
        canOverride: true,
      },
    );
    assert.deepEqual(
      (audited[0] as { requested: { missing: string[] } }).requested.missing,
      ["feladott csomag"],
    );
  });

  /*
    A SZEMÉLYES KISZÁLLÍTÁS (Luca, 2026-11-20; acrobot 57771): csomag nélküli Kiszállítás, ha a kolléga viszi ki; számla kell, külön naplósor (ki, mikor, ok),
    külön választás a felületen. MI PIROSÍT: ha számla nélkül átmegy; ha jog vagy indok kellene hozzá; ha a naplósor a webshop-hívás UTÁN íródik (a Stripe-levonás
    a Kiszállításra fut: a nyomnak előbb kell megvolnia); ha a sor felülbírálásként, nem személyes kiszállításként íródik; ha a bolti átvételnél hamis nyom marad;
    ha egy indok mellette felülbírálássá teszi; ha a napló ok-szövege a kezelő szava (állandó); ha a válasz nem jelzi a személyes kiszállítást.
  */
  const PERSONAL_TRACE = {
    kind: "personal",
    userId: "user_1",
    orderId: "order_38",
    from: "stocking",
    to: "out_for_delivery",
    reason: PERSONAL_DELIVERY_REASON,
    missing: ["feladott csomag"],
  };

  it("personal delivery ships with the invoice and no parcel, without any right: the trace is requested, applied, then the status row", async () => {
    const { orders, sent, audited } = statusService({ parcel: false });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      { personalDelivery: true, canOverride: false },
    );
    assert.equal(sent.length, 1);
    assert.equal(result.personalDelivery, true);
    assert.equal(result.shippingGateOverridden, false);
    assert.deepEqual(audited, [
      { requested: PERSONAL_TRACE },
      { applied: "audit_row_1", trace: PERSONAL_TRACE },
      {
        userId: "user_1",
        orderId: "order_38",
        from: "stocking",
        to: "out_for_delivery",
      },
    ]);
  });

  it("personal delivery without the invoice is a 409 with its own sentence: nothing reaches the webshop or the audit", async () => {
    const { orders, sent, audited } = statusService({
      invoice: false,
      parcel: false,
    });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW, {
        personalDelivery: true,
        canOverride: true,
      }),
      (error: unknown) => {
        assert.equal((error as Error).constructor.name, "ConflictException");
        assert.match(
          (error as Error).message,
          /személyes kiszállításhoz is kell kiállított számla/,
        );
        return true;
      },
    );
    assert.deepEqual([sent, audited], [[], []]);
  });

  it("the personal trace is written BEFORE the webshop call: if it cannot be written nothing is sent, and a webshop refusal leaves it requested", async () => {
    const noTrace = statusService({ parcel: false, requestError: true });
    await assert.rejects(
      noTrace.orders.changeStatus(
        "order_38",
        "out_for_delivery",
        "user_1",
        true,
        NOW,
        { personalDelivery: true },
      ),
      /audit write failed/,
    );
    assert.deepEqual([noTrace.sent, noTrace.audited], [[], []]);
    const refused = statusService({
      parcel: false,
      transitionError: new MedusaAdminHttpError(
        422,
        JSON.stringify({ message: "A levonás nem sikerült" }),
      ),
    });
    await assert.rejects(
      refused.orders.changeStatus(
        "order_38",
        "out_for_delivery",
        "user_1",
        true,
        NOW,
        { personalDelivery: true },
      ),
      (error: unknown) =>
        (error as Error).constructor.name === "UnprocessableEntityException",
    );
    assert.equal(refused.sent.length, 0);
    assert.deepEqual(refused.audited, [{ requested: PERSONAL_TRACE }]);
  });

  it("a store pickup leaves no personal trace: the choice does not apply there", async () => {
    const { orders, audited } = statusService({
      storePickup: true,
      invoice: false,
      parcel: false,
    });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      { personalDelivery: true },
    );
    assert.equal(result.personalDelivery, false);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        from: "stocking",
        to: "out_for_delivery",
      },
    ]);
  });

  it("a reason sent with the personal choice is not an override: the trace is the personal one with the constant reason", async () => {
    const { orders, audited } = statusService({ parcel: false });
    const result = await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        personalDelivery: true,
        overrideReason: "A csomagot a GLS portálján adtuk fel kézzel",
        canOverride: true,
      },
    );
    assert.equal(result.shippingGateOverridden, false);
    assert.equal(result.personalDelivery, true);
    assert.deepEqual(audited[0], { requested: PERSONAL_TRACE });
  });

  it("with a parcel already there the personal trace names no missing part", async () => {
    const { orders, audited } = statusService({ parcel: true });
    await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
      {
        personalDelivery: true,
      },
    );
    assert.deepEqual(audited[0], {
      requested: { ...PERSONAL_TRACE, missing: [] },
    });
  });

  it("with the invoice and the parcel, shipping goes (the default of the other tests)", async () => {
    const { orders, sent } = statusService({ invoice: true, parcel: true });
    await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
    );
    assert.equal(sent.length, 1);
  });

  it("a store pickup is not gated: it has no parcel", async () => {
    const { orders, sent } = statusService({
      storePickup: true,
      invoice: false,
      parcel: false,
    });
    await orders.changeStatus(
      "order_38",
      "out_for_delivery",
      "user_1",
      true,
      NOW,
    );
    assert.equal(sent.length, 1);
  });

  it("only shipping is gated: closing unsuccessfully needs neither", async () => {
    const { orders, sent } = statusService({ invoice: false, parcel: false });
    await orders.changeStatus(
      "order_38",
      "closed_unsuccessfully",
      "user_1",
      true,
      NOW,
    );
    assert.equal(sent.length, 1);
  });

  it("a stale page gets the 'refresh' sentence, not the gate's: the table is checked first", async () => {
    const { orders } = statusService({ invoice: false, parcel: false });
    await assert.rejects(
      orders.changeStatus("order_38", "closed", "user_1", true, NOW),
      /Frissítsd az oldalt/,
    );
  });

  it("a refused capture is 422 with the webshop's own sentence, and nothing is audited", async () => {
    const refusal = new MedusaAdminHttpError(
      400,
      JSON.stringify({
        type: "not_allowed",
        message:
          "The shared card payment cannot be captured for 21950 (authorized 17000)",
      }),
    );
    const { orders, audited } = statusService({ transitionError: refusal });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW),
      (error: unknown) => {
        assert.equal(
          (error as Error).constructor.name,
          "UnprocessableEntityException",
        );
        assert.match(
          (error as Error).message,
          /A státusz nem változott\. A webshop válasza: The shared card payment cannot be captured/,
        );
        return true;
      },
    );
    assert.deepEqual(audited, []);
  });

  it("a webshop 5xx is 503; an order without status is 404", async () => {
    const { orders } = statusService({
      transitionError: new MedusaAdminHttpError(502, "bad gateway"),
    });
    await assert.rejects(
      orders.changeStatus("order_38", "out_for_delivery", "user_1", true, NOW),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        return true;
      },
    );
    await assert.rejects(
      statusService({ noStatus: true }).orders.changeStatus(
        "order_38",
        "out_for_delivery",
        "u",
        true,
        NOW,
      ),
      (error: unknown) => {
        assert.equal((error as Error).constructor.name, "NotFoundException");
        return true;
      },
    );
  });
});

describe("the active stock shortage on the list (card ac167fc2, third slice)", () => {
  /*
    MI PIROSÍT: ha az aktív (OPEN vagy AGREED) hiány nem jelenik meg a rendelés során, vagy a nyitott és a megállapodott darabszám
    felcserélődik; ha a hiány nélküli rendelés is kap jelölést; ha a szűrő nem csak a hiányosakat adja; ha a számláló a szűrőtől függ
    (a többi számlálóhoz hasonlóan a nézet szerint számol); ha a lista rendelésenként kérdez az OS-től (EGY kötegelt olvasás kell az oldal
    azonosítóira).
  */
  const reset = () => {
    shortagesNow.map = new Map();
    shortagesNow.asked = [];
  };

  it("puts the open and agreed counts on the order's row, and null on the others", async () => {
    shortagesNow.map = new Map([
      ["order_1", { open: 1, agreed: 0 }],
      ["order_3", { open: 0, agreed: 2 }],
    ]);
    try {
      const result = await service([order(1), order(2), order(3)]).orders.list(
        { view: "all" },
        NOW,
      );
      assert.deepEqual(
        result.items.map((item) => [item.id, item.stockShortage]).sort(),
        [
          ["order_1", { open: 1, agreed: 0 }],
          ["order_2", null],
          ["order_3", { open: 0, agreed: 2 }],
        ],
      );
    } finally {
      reset();
    }
  });

  it("filters to the orders with an active shortage, and counts them by the view, not by the filter", async () => {
    shortagesNow.map = new Map([
      ["order_1", { open: 1, agreed: 0 }],
      ["order_3", { open: 0, agreed: 1 }],
    ]);
    try {
      const orders = [order(1), order(2), order(3), order(4)];
      const filtered = await service(orders).orders.list(
        { view: "all", shortage: "active" },
        NOW,
      );
      assert.deepEqual(filtered.items.map((item) => item.id).sort(), [
        "order_1",
        "order_3",
      ]);
      assert.equal(filtered.total, 2);
      assert.equal(filtered.shortageOrders, 2);
      const unfiltered = await service(orders).orders.list(
        { view: "all" },
        NOW,
      );
      assert.equal(unfiltered.total, 4);
      assert.equal(unfiltered.shortageOrders, 2);
      // another filter narrows the page, not the count (it follows the view, like the other counters)
      const searched = await service(orders).orders.list(
        { view: "all", q: "vevo1@" },
        NOW,
      );
      assert.equal(searched.total, 1);
      assert.equal(searched.shortageOrders, 2);
    } finally {
      reset();
    }
  });

  it("asks the OS ONCE for all the order ids of the list, not once per order", async () => {
    try {
      await service([order(1), order(2), order(3)]).orders.list(
        { view: "all" },
        NOW,
      );
      assert.equal(shortagesNow.asked.length, 1);
      assert.deepEqual([...shortagesNow.asked[0]!].sort(), [
        "order_1",
        "order_2",
        "order_3",
      ]);
    } finally {
      reset();
    }
  });
});
