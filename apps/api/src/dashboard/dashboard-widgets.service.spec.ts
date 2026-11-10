import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  presetDashboardLayout,
  type AuthenticatedUser,
  type DashboardLayoutEntry,
  type ServiceCapabilityValue,
  type UserRole,
} from "@acropora/types";

import type { ExpectedArrivalService } from "../purchasing/expected-arrivals/expected-arrival.service.js";
import type { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { UnasStockSyncOutboxRepository } from "../inventory/unas-stock-sync-outbox.repository.js";
import type { ContentService } from "../content/content.service.js";
import type { MessagesService } from "../messages/messages.service.js";
import type { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import type { WebshopOrdersService } from "../orders/webshop-orders/webshop-orders.service.js";
import type { PartnerOrdersService } from "../partner-orders/partner-orders.service.js";
import type { DashboardAquariumWidgetsRepository } from "./dashboard-aquarium-widgets.repository.js";
import type { DashboardFinanceWidgetsRepository } from "./dashboard-finance-widgets.repository.js";
import type { DashboardLayoutRepository } from "./dashboard-layout.repository.js";
import type { DashboardServiceWidgetsRepository } from "./dashboard-service-widgets.repository.js";
import type { DashboardSystemWidgetsRepository } from "./dashboard-system-widgets.repository.js";
import {
  DashboardWidgetsService,
  WIDGET_UNAVAILABLE_MESSAGE,
} from "./dashboard-widgets.service.js";

const user = (role: UserRole): AuthenticatedUser => ({
  id: `${role.toLowerCase()}-user`,
  email: `${role.toLowerCase()}@example.invalid`,
  displayName: role,
  role,
  customerId: null,
  supplierId: null,
});

interface Store {
  layout: unknown;
  saved: DashboardLayoutEntry[] | null;
  deleted: number;
}

function service(
  options: {
    stored?: unknown;
    capabilities?: ServiceCapabilityValue[];
    loaders?: ConstructorParameters<typeof DashboardWidgetsService>[13];
    webshopOrders?: Partial<WebshopOrdersService>;
    messages?: Partial<MessagesService>;
    partnerOrders?: Partial<PartnerOrdersService>;
    content?: Partial<ContentService>;
    financeWidgets?: Partial<DashboardFinanceWidgetsRepository>;
  } = {},
) {
  const store: Store = {
    layout: options.stored ?? null,
    saved: null,
    deleted: 0,
  };
  const repository = {
    findLayout: async () => store.layout,
    saveLayout: async (_: string, widgets: DashboardLayoutEntry[]) => {
      store.saved = widgets;
    },
    deleteLayout: async () => {
      store.deleted += 1;
    },
    capabilities: async () => options.capabilities ?? [],
    tasksWidget: async () => ({ openCount: 2, latest: [] }),
  } as unknown as DashboardLayoutRepository;
  const expectedArrivals = {
    list: async () => ({
      items: [
        {
          supplierName: "Kitalált Kft.",
          stage: "PROFORMA",
          arrivedAt: "2026-09-30T08:00:00.000Z",
        },
        { supplierName: "Példa Bt.", stage: "INVOICE", arrivedAt: null },
        { supplierName: "Minta Zrt.", stage: "INVOICE", arrivedAt: null },
      ],
      dismissed: [],
    }),
  } as unknown as ExpectedArrivalService;
  return {
    store,
    svc: new DashboardWidgetsService(
      repository,
      expectedArrivals,
      {} as DashboardServiceWidgetsRepository,
      {} as DashboardAquariumWidgetsRepository,
      (options.financeWidgets ?? {}) as DashboardFinanceWidgetsRepository,
      {} as MissingInvoicesService,
      {} as StockReconciliationService,
      {} as UnasStockSyncOutboxRepository,
      {} as DashboardSystemWidgetsRepository,
      (options.webshopOrders ?? {}) as WebshopOrdersService,
      (options.messages ?? {}) as MessagesService,
      (options.partnerOrders ?? {}) as PartnerOrdersService,
      (options.content ?? {}) as ContentService,
      options.loaders,
    ),
  };
}

describe("the layout", () => {
  it("without an own layout returns the role preset and only what the user may add", async () => {
    const { svc } = service();
    const r = await svc.layout(user("SERVICE"));
    assert.equal(r.source, "preset");
    assert.deepEqual(
      r.widgets,
      presetDashboardLayout({ role: "SERVICE", capabilities: [] }),
    );
    assert.deepEqual(
      r.available.map((w) => w.id),
      [
        "attention",
        "tasks",
        "messages",
        "service-tickets",
        "worksheets",
        "maintenance-calendar",
        "aquarium-alerts",
        "water-values",
        "aquarium-equipment",
      ],
    );
    // the registry is never exposed whole
    assert.ok(!("availability" in (r.available[0] ?? {})));
  });

  it("a stored layout wins, re-filtered through today's permissions", async () => {
    const { svc } = service({
      stored: [
        { widgetId: "expected-arrivals", enabled: true, order: 0 },
        { widgetId: "tasks", enabled: true, order: 1 },
      ],
    });
    const r = await svc.layout(user("SERVICE"));
    assert.equal(r.source, "custom");
    assert.deepEqual(
      r.widgets.filter((w) => w.enabled).map((w) => w.widgetId),
      ["tasks"],
    );
    assert.ok(!r.widgets.some((w) => w.widgetId === "expected-arrivals"));
  });

  it("saves a valid layout normalized, and returns it resolved", async () => {
    const { svc, store } = service();
    const r = await svc.saveLayout(user("WAREHOUSE"), {
      widgets: [
        { widgetId: "tasks", enabled: false, order: 0 },
        { widgetId: "expected-arrivals", enabled: true, order: 9 },
      ],
    });
    assert.deepEqual(
      store.saved?.map((e) => [e.widgetId, e.enabled, e.order]),
      [
        ["expected-arrivals", true, 0],
        ["tasks", false, 1],
      ],
    );
    assert.equal(r.source, "custom");
  });

  it("refuses to save a widget the user may not have, and saves nothing", async () => {
    const { svc, store } = service();
    await assert.rejects(
      svc.saveLayout(user("SERVICE"), {
        widgets: [{ widgetId: "expected-arrivals", enabled: true, order: 0 }],
      }),
      BadRequestException,
    );
    await assert.rejects(
      svc.saveLayout(user("SERVICE"), "nope"),
      BadRequestException,
    );
    assert.equal(store.saved, null);
  });

  it("reset deletes the own layout and returns the preset", async () => {
    const { svc, store } = service({
      stored: [{ widgetId: "tasks", enabled: false, order: 0 }],
    });
    const r = await svc.resetLayout(user("WAREHOUSE"));
    assert.equal(store.deleted, 1);
    assert.equal(r.source, "preset");
    assert.deepEqual(
      r.widgets.filter((w) => w.enabled).map((w) => w.widgetId),
      [
        "attention",
        "tasks",
        "expected-arrivals",
        "stock-reconciliation",
        "stock-sync-outbox",
      ],
    );
  });
});

describe("the widget data endpoint (server-side authorization)", () => {
  it("returns forbidden for a widget the user lacks the permission for, even when asked", async () => {
    let called = 0;
    const { svc } = service({
      loaders: {
        "expected-arrivals": async () => {
          called += 1;
          return {};
        },
        tasks: async () => ({ openCount: 1, latest: [] }),
      },
    });
    const r = await svc.widgets(user("SERVICE"), [
      "expected-arrivals",
      "tasks",
    ]);
    assert.deepEqual(r.results["expected-arrivals"], { status: "forbidden" });
    assert.equal(r.results.tasks?.status, "ok");
    assert.equal(
      called,
      0,
      "the loader of a forbidden widget must not even run",
    );
  });

  it("a planned widget is unavailable, not data", async () => {
    const { svc } = service();
    const r = await svc.widgets(user("OWNER"), ["pos-today", "today-service"]);
    assert.deepEqual(r.results["pos-today"], { status: "unavailable" });
    assert.deepEqual(r.results["today-service"], { status: "unavailable" });
  });

  it("one failing source does not take the others down, and its result is an error, never a zero", async () => {
    const { svc } = service({
      loaders: {
        tasks: async () => {
          throw new Error("synthetic database outage");
        },
        "expected-arrivals": async () => ({ count: 1 }),
      },
    });
    const r = await svc.widgets(user("OWNER"), ["tasks", "expected-arrivals"]);
    assert.deepEqual(r.results.tasks, {
      status: "error",
      message: WIDGET_UNAVAILABLE_MESSAGE,
    });
    assert.deepEqual(r.results["expected-arrivals"], {
      status: "ok",
      data: { count: 1 },
    });
  });

  // AN UNKNOWN ID IS UNAVAILABLE, AND THE REST GOES THROUGH (owner,
  // 2026-10-02): an older phone build may ask for an id that no longer
  // exists. What must fail: the whole request refused; the unknown id
  // dropped silently (the client would wait for it); a loader run for it.
  it("an unknown widget id is unavailable on its own; the known ones still answer", async () => {
    let loaded = 0;
    const { svc } = service({
      loaders: {
        "expected-arrivals": async () => {
          loaded += 1;
          return { count: 1 };
        },
      },
    });
    const r = await svc.widgets(user("OWNER"), [
      "nope",
      "expected-arrivals",
      "nope",
    ]);
    assert.deepEqual(r.results["nope"], { status: "unavailable" });
    assert.deepEqual(r.results["expected-arrivals"], {
      status: "ok",
      data: { count: 1 },
    });
    assert.deepEqual(Object.keys(r.results).sort(), [
      "expected-arrivals",
      "nope",
    ]);
    assert.equal(loaded, 1);
  });

  it("expected arrivals come from the purchasing list, counted by stage", async () => {
    const { svc } = service();
    const r = await svc.widgets(user("WAREHOUSE"), ["expected-arrivals"]);
    assert.deepEqual(r.results["expected-arrivals"], {
      status: "ok",
      data: {
        count: 3,
        byStage: { PROFORMA: 1, INVOICE: 2, LATE_CORRECTION: 0 },
        latest: [
          {
            supplierName: "Kitalált Kft.",
            stage: "PROFORMA",
            arrivedAt: "2026-09-30T08:00:00.000Z",
          },
          { supplierName: "Példa Bt.", stage: "INVOICE", arrivedAt: null },
          { supplierName: "Minta Zrt.", stage: "INVOICE", arrivedAt: null },
        ],
      },
    });
  });
});

describe("Webshop rendelési sor", () => {
  const counters = {
    processing: 4,
    invoice: 7,
    dispatch: 2,
    pickup: 1,
    stale: 53,
  };

  it("shows the order list's own open-view counters, read once for five minutes", async () => {
    const queries: unknown[] = [];
    const { svc } = service({
      webshopOrders: {
        list: async (query: unknown) => {
          queries.push(query);
          return { counters, truncated: false } as never;
        },
      },
    });
    const first = await svc.widgets(user("OWNER"), ["webshop-orders"]);
    assert.deepEqual(first.results["webshop-orders"], {
      status: "ok",
      data: { counters, truncated: false },
    });
    await svc.widgets(user("OWNER"), ["webshop-orders"]);
    assert.deepEqual(queries, [{ view: "open", pageSize: 1 }]);
  });

  it("an unreachable webshop is an error on the card, never a zero", async () => {
    const { svc } = service({
      webshopOrders: {
        list: async () => {
          throw new Error("A webshop kapcsolata nincs beállítva.");
        },
      },
    });
    const r = await svc.widgets(user("OWNER"), ["webshop-orders"]);
    assert.equal(r.results["webshop-orders"]?.status, "error");
  });
});

describe("Olvasatlan üzenetek", () => {
  it("reads the menu badge's own count for the asking user, every time", async () => {
    const asked: string[] = [];
    const { svc } = service({
      messages: {
        unread: async (who: { id: string }) => {
          asked.push(who.id);
          return { total: 5, conversations: 2 };
        },
      } as never,
    });
    const r = await svc.widgets(user("SERVICE"), ["messages"]);
    assert.deepEqual(r.results.messages, {
      status: "ok",
      data: { total: 5, conversations: 2 },
    });
    await svc.widgets(user("SERVICE"), ["messages"]);
    assert.equal(asked.length, 2, "a per-user count is never cached");
  });
});

/*
  A JÓVÁHAGYÁSRA VÁRÓ TARTALOM KÁRTYÁJA (T5.1 PR2, acrobot 45938). MI PIROSÍT: ha a szám nem a tartalom-szolgáltatás
  jóváhagyásra váró számlálójából jön; ha a content.approve nélküli szerepkör (a MANAGER ír, de nem hagy jóvá) megkapja; ha a
  szám felhasználónként gyorsítótárba kerül; ha a hibás számláló a teljes vezérlőpultot viszi el.
*/
describe("Jóváhagyásra váró tartalom", () => {
  it("gives the approver the content service's own count, every time", async () => {
    let asked = 0;
    const { svc } = service({
      content: {
        awaitingApproval: async () => {
          asked += 1;
          return { total: 3, overdue: 1 };
        },
      },
    });
    const r = await svc.widgets(user("OWNER"), ["content-approval"]);
    assert.deepEqual(r.results["content-approval"], {
      status: "ok",
      data: { total: 3, overdue: 1 },
    });
    await svc.widgets(user("ADMIN"), ["content-approval"]);
    assert.equal(asked, 2);
  });

  it("is forbidden for a role without content.approve", async () => {
    const { svc } = service({
      content: { awaitingApproval: async () => ({ total: 3, overdue: 1 }) },
    });
    for (const role of ["MANAGER", "SALES", "SERVICE", "VIEWER"] as const)
      assert.deepEqual(
        (await svc.widgets(user(role), ["content-approval"])).results[
          "content-approval"
        ],
        { status: "forbidden" },
        role,
      );
  });

  it("a failing count is that card's error, not the dashboard's", async () => {
    const { svc } = service({
      content: {
        awaitingApproval: async () => {
          throw new Error("db down");
        },
      },
    });
    const r = await svc.widgets(user("OWNER"), ["content-approval", "tasks"]);
    assert.equal(r.results["content-approval"]?.status, "error");
    assert.equal(r.results.tasks?.status, "ok");
  });
});

/*
  A HATRALEKOS MEGRENDELESEK KARTYAJA (S4b-2, 38caeac2). MI PIROSIT: ha a kartya adata nem a megrendelesek szolgaltatasa
  hatralek-osszefoglalojabol jon (a szam es a szurt lista kulonbozne); ha a quotes.view nelkuli felhasznalo megkapja;
  ha a szerver az osszefoglalo hibajat a teljes vezerlopulttal viszi el.
*/
describe("Hátralékos megrendelések", () => {
  const summary = {
    count: 2,
    backlogDays: 14,
    oldest: [
      {
        orderId: "o1",
        orderNumber: "MR-1",
        customerName: "A Kft.",
        idleDays: 30,
      },
      { orderId: "o2", orderNumber: "MR-2", customerName: null, idleDays: 15 },
    ],
  };

  it("gives the card the orders service's own backlog summary", async () => {
    const { svc } = service({
      partnerOrders: { backlogSummary: async () => summary },
    });
    const r = await svc.widgets(user("SALES"), ["partner-order-backlog"]);
    assert.deepEqual(r.results["partner-order-backlog"], {
      status: "ok",
      data: summary,
    });
  });

  it("is forbidden for a role without quotes.view", async () => {
    const { svc } = service({
      partnerOrders: { backlogSummary: async () => summary },
    });
    const r = await svc.widgets(user("SERVICE"), ["partner-order-backlog"]);
    assert.deepEqual(r.results["partner-order-backlog"], {
      status: "forbidden",
    });
  });

  it("a failing summary is that card's error, not the dashboard's", async () => {
    const { svc } = service({
      partnerOrders: {
        backlogSummary: async () => {
          throw new Error("db down");
        },
      },
    });
    const r = await svc.widgets(user("SALES"), [
      "partner-order-backlog",
      "tasks",
    ]);
    assert.equal(r.results["partner-order-backlog"]?.status, "error");
    assert.equal(r.results.tasks?.status, "ok");
  });
});

describe("lejáró számlák: az adószám nélkül kiállított számla (kártya aaf4f09d)", () => {
  // MI PIROSÍT: ha a widget nem a kapu szabályával számolja a tegnapi és mai számlákat
  it("a tegnap és ma kiállított, adószám nélküli céges számlákat számolja", async () => {
    const asked: Date[] = [];
    const { svc } = service({
      financeWidgets: {
        overdueInvoiceRows: async () => [],
        issuedForBuyerTaxCheck: async (from: Date) => {
          asked.push(from);
          return [
            {
              invoiceNumber: "ACRW-2026/00510",
              issueDate: new Date(),
              partnerName: "Fővárosi Állat- és Növénykert",
              partnerTaxNumber: null,
              buyerSnapshot: null,
              customer: { type: "PERSON", partner: { id: "s-1" } },
            },
            {
              invoiceNumber: "ACRW-2026/00511",
              issueDate: new Date(),
              partnerName: "Kovács Anna",
              partnerTaxNumber: null,
              buyerSnapshot: null,
              customer: { type: "PERSON", partner: null },
            },
          ];
        },
      },
    });
    const r = await svc.widgets(user("OWNER"), ["overdue-invoices"]);
    const result = r.results["overdue-invoices"] as {
      status: string;
      data: { withoutBuyerTaxNumber: number };
    };
    assert.equal(result.status, "ok");
    assert.equal(result.data.withoutBuyerTaxNumber, 1);
    assert.equal(asked.length, 1);
    assert.ok(Date.now() - asked[0]!.getTime() <= 2 * 86_400_000);
    assert.ok(Date.now() - asked[0]!.getTime() >= 86_400_000 - 2 * 3_600_000);
  });
});

describe("Figyelmet igényel", () => {
  const overdue = {
    overdue: { count: 2, openAmounts: [] },
    dueToday: 0,
    dueWithinWeek: 0,
    noPaymentDataPastDue: 0,
    withoutBuyerTaxNumber: 0,
  };
  const tickets = { openCount: 3, byStatus: { NEW: 3 }, oldestOpenAt: null };

  it("reads only the widgets the user may see; the others are not even loaded", async () => {
    const loaded: string[] = [];
    const track = (id: string, data: unknown) => async (): Promise<unknown> => {
      loaded.push(id);
      return data;
    };
    const { svc } = service({
      loaders: {
        "overdue-invoices": track("overdue-invoices", overdue),
        "service-tickets": track("service-tickets", tickets),
      },
    });
    // the attention loader is the real one
    (svc as unknown as { loaders: Record<string, unknown> }).loaders.attention =
      (
        svc as unknown as {
          defaultLoaders(): Record<string, unknown>;
        }
      ).defaultLoaders().attention;
    const r = await svc.widgets(user("SERVICE"), ["attention"]);
    assert.equal(r.results.attention?.status, "ok");
    assert.deepEqual(loaded, ["service-tickets"]);
    const data = (r.results.attention as { data: { items: { key: string }[] } })
      .data;
    assert.deepEqual(
      data.items.map((i) => i.key),
      ["new"],
    );
  });

  it("a failing source is named unavailable, never counted as zero; the rest still shows", async () => {
    const { svc } = service({
      loaders: {
        "overdue-invoices": async () => {
          throw new Error("synthetic outage");
        },
        "service-tickets": async () => tickets,
      },
    });
    (svc as unknown as { loaders: Record<string, unknown> }).loaders.attention =
      (
        svc as unknown as { defaultLoaders(): Record<string, unknown> }
      ).defaultLoaders().attention;
    const r = await svc.widgets(user("OWNER"), ["attention"]);
    const data = (
      r.results.attention as {
        data: {
          items: { widgetId: string }[];
          unavailable: { widgetId: string; title: string }[];
        };
      }
    ).data;
    assert.deepEqual(data.unavailable, [
      { widgetId: "overdue-invoices", title: "Lejáró számlák" },
    ]);
    assert.ok(!data.items.some((i) => i.widgetId === "overdue-invoices"));
    assert.ok(data.items.some((i) => i.widgetId === "service-tickets"));
  });

  it("a card and the attention list in one request share one load", async () => {
    let calls = 0;
    const { svc } = service({
      loaders: {
        "service-tickets": async () => {
          calls += 1;
          return tickets;
        },
      },
    });
    (svc as unknown as { loaders: Record<string, unknown> }).loaders.attention =
      (
        svc as unknown as { defaultLoaders(): Record<string, unknown> }
      ).defaultLoaders().attention;
    const r = await svc.widgets(user("OWNER"), [
      "service-tickets",
      "attention",
    ]);
    assert.equal(r.results["service-tickets"]?.status, "ok");
    assert.equal(r.results.attention?.status, "ok");
    assert.equal(calls, 1);
  });
});
