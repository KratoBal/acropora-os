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
import type { DashboardLayoutRepository } from "./dashboard-layout.repository.js";
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
    loaders?: ConstructorParameters<typeof DashboardWidgetsService>[2];
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
      ["tasks"],
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
      r.widgets.map((w) => w.widgetId),
      ["tasks"],
    );
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
      ["tasks", "expected-arrivals"],
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

  it("an unknown widget id is a bad request", async () => {
    const { svc } = service();
    await assert.rejects(
      svc.widgets(user("OWNER"), ["nope"]),
      BadRequestException,
    );
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
