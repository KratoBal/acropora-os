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
import type { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
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
    loaders?: ConstructorParameters<typeof DashboardWidgetsService>[9];
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
      {} as DashboardFinanceWidgetsRepository,
      {} as MissingInvoicesService,
      {} as StockReconciliationService,
      {} as UnasStockSyncOutboxRepository,
      {} as DashboardSystemWidgetsRepository,
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
    const r = await svc.widgets(user("OWNER"), [
      "webshop-orders",
      "today-service",
    ]);
    assert.deepEqual(r.results["webshop-orders"], { status: "unavailable" });
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

describe("Figyelmet igényel", () => {
  const overdue = {
    overdue: { count: 2, openAmounts: [] },
    dueToday: 0,
    dueWithinWeek: 0,
    noPaymentDataPastDue: 0,
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
