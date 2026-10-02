import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasAllPermissions,
  PERMISSIONS,
  USER_ROLES,
  type UserRole,
} from "./auth.js";
import {
  availableDashboardWidgets,
  availableStarterLayouts,
  DASHBOARD_ROLE_PRESETS,
  DASHBOARD_WIDGET_IDS,
  DASHBOARD_WIDGETS,
  dashboardWidget,
  isDashboardWidgetAvailable,
  presetDashboardLayout,
  resolveDashboardLayout,
  sanitizeDashboardLayoutInput,
  starterDashboardLayout,
  type DashboardViewer,
  type DashboardWidgetDefinition,
} from "./dashboard-widgets.js";

const viewer = (
  role: UserRole,
  capabilities: DashboardViewer["capabilities"] = [],
): DashboardViewer => ({ role, capabilities });

const ids = (entries: { widgetId: string; enabled: boolean }[]) =>
  entries.filter((e) => e.enabled).map((e) => e.widgetId);

describe("the registry", () => {
  it("has every id exactly once, and only ids from the closed list", () => {
    const seen = DASHBOARD_WIDGETS.map((w) => w.id);
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual([...seen].sort(), [...DASHBOARD_WIDGET_IDS].sort());
  });

  it("uses only existing permissions (no parallel permission system)", () => {
    const known = new Set<string>(Object.values(PERMISSIONS));
    for (const w of DASHBOARD_WIDGETS)
      for (const p of w.requiredPermissions)
        assert.ok(known.has(p), `${w.id}: ${p}`);
  });

  it("names the gap for every widget that is not active, and the source for every active one", () => {
    for (const w of DASHBOARD_WIDGETS) {
      if (w.availability === "active")
        assert.ok(w.dataSource, `${w.id} is active without a data source`);
      else assert.ok(w.plannedReason, `${w.id} is not active without a reason`);
      assert.ok(w.supportedSizes.includes(w.defaultSize), w.id);
    }
  });

  it("keeps the frozen webshop / commerce widgets and the shadow JEV pairing out of reach of every role", () => {
    for (const id of [
      "webshop-orders",
      "pos-today",
      "product-data-quality",
      "supplier-matching",
    ] as const) {
      assert.notEqual(dashboardWidget(id).availability, "active", id);
      for (const role of USER_ROLES)
        assert.ok(
          !availableDashboardWidgets(viewer(role)).some((w) => w.id === id),
          `${role} gets ${id}`,
        );
    }
  });
});

describe("the read-only stock-sync outbox (owner decision 2026-10-02)", () => {
  it("is active for inventory viewers, and only for them", () => {
    assert.equal(dashboardWidget("stock-sync-outbox").availability, "active");
    for (const role of USER_ROLES)
      assert.equal(
        availableDashboardWidgets(viewer(role)).some(
          (w) => w.id === "stock-sync-outbox",
        ),
        hasAllPermissions(role, [PERMISSIONS.INVENTORY_VIEW]),
        role,
      );
  });
});

describe("permission filtering", () => {
  it("for every role: only active widgets whose every permission the role holds", () => {
    for (const role of USER_ROLES)
      for (const w of availableDashboardWidgets(viewer(role))) {
        assert.equal(w.availability, "active", `${role}: ${w.id}`);
        assert.ok(
          hasAllPermissions(role, w.requiredPermissions),
          `${role}: ${w.id}`,
        );
      }
  });

  it("a service technician gets no purchasing widget; the warehouse does", () => {
    const service = availableDashboardWidgets(viewer("SERVICE")).map(
      (w) => w.id,
    );
    const warehouse = availableDashboardWidgets(viewer("WAREHOUSE")).map(
      (w) => w.id,
    );
    assert.ok(!service.includes("expected-arrivals"));
    assert.ok(warehouse.includes("expected-arrivals"));
    assert.ok(service.includes("tasks"));
  });

  it("an active widget needs EVERY required permission, not one of them", () => {
    const both: DashboardWidgetDefinition = {
      ...dashboardWidget("tasks"),
      requiredPermissions: [PERMISSIONS.TASKS_VIEW, PERMISSIONS.FINANCE_VIEW],
    };
    assert.equal(isDashboardWidgetAvailable(both, viewer("SERVICE")), false);
    assert.equal(isDashboardWidgetAvailable(both, viewer("OWNER")), true);
  });

  it("a widget requiring a capability needs the capability on top of the permission", () => {
    const capable: DashboardWidgetDefinition = {
      ...dashboardWidget("material-requests"),
      availability: "active",
    };
    assert.equal(isDashboardWidgetAvailable(capable, viewer("SERVICE")), false);
    assert.equal(
      isDashboardWidgetAvailable(
        capable,
        viewer("SERVICE", ["MATERIAL_REQUEST_MARK_RECEIVED"]),
      ),
      true,
    );
    // the capability never stands in for the permission
    assert.equal(
      isDashboardWidgetAvailable(
        capable,
        viewer("WAREHOUSE", ["MATERIAL_REQUEST_MARK_RECEIVED"]),
      ),
      false,
    );
  });

  it("a planned widget is never available, whatever the permissions", () => {
    const planned = dashboardWidget("today-service");
    assert.equal(isDashboardWidgetAvailable(planned, viewer("OWNER")), false);
  });
});

describe("role presets", () => {
  it("are filtered through the permissions for every role (a preset never grants)", () => {
    for (const role of USER_ROLES) {
      const available = new Set(
        availableDashboardWidgets(viewer(role)).map((w) => w.id),
      );
      for (const entry of presetDashboardLayout(viewer(role)))
        assert.ok(available.has(entry.widgetId), `${role}: ${entry.widgetId}`);
    }
  });

  it("enables the preset's widgets in the preset's order and offers the rest disabled", () => {
    const layout = presetDashboardLayout(viewer("OWNER"));
    // the owner preset has no service widget; tasks and arrivals are active
    assert.deepEqual(ids(layout), ["tasks", "expected-arrivals"]);
    assert.deepEqual(
      layout.map((e) => e.order),
      layout.map((_, i) => i),
    );
    const warehouse = presetDashboardLayout(viewer("WAREHOUSE"));
    // Készletfigyelő stays planned: no reliable stock threshold
    assert.deepEqual(ids(warehouse), [
      "tasks",
      "expected-arrivals",
      "stock-reconciliation",
      "stock-sync-outbox",
    ]);
    const service = presetDashboardLayout(viewer("SERVICE"));
    // Mai szerviz is planned; material requests need the capability
    assert.deepEqual(ids(service), [
      "service-tickets",
      "worksheets",
      "tasks",
      "maintenance-calendar",
    ]);
    const capable = presetDashboardLayout(
      viewer("SERVICE", ["MATERIAL_REQUEST_MARK_RECEIVED"]),
    );
    assert.deepEqual(ids(capable), [
      "service-tickets",
      "worksheets",
      "material-requests",
      "tasks",
      "maintenance-calendar",
    ]);
  });

  it("a role without a preset gets an empty, but offered, dashboard", () => {
    assert.equal(DASHBOARD_ROLE_PRESETS.CONTENT_AGENT, undefined);
    for (const entry of presetDashboardLayout(viewer("CONTENT_AGENT")))
      assert.equal(entry.enabled, false);
  });

  it("starter layouts are offered only when they would give the viewer something", () => {
    const owner = availableStarterLayouts(viewer("OWNER")).map((s) => s.id);
    assert.ok(owner.includes("finance")); // expected arrivals
    assert.ok(owner.includes("aquarium")); // tasks
    assert.deepEqual(
      ids(starterDashboardLayout(viewer("WAREHOUSE"), "finance") ?? []),
      // purchasing.view, no finance.view / billing.view
      ["incoming-invoices", "expected-arrivals"],
    );
    assert.equal(starterDashboardLayout(viewer("OWNER"), "nope"), null);
  });
});

describe("the user's own layout", () => {
  it("no stored layout (or a reset) means the preset", () => {
    const resolved = resolveDashboardLayout(viewer("WAREHOUSE"), null);
    assert.equal(resolved.source, "preset");
    assert.deepEqual(
      resolved.widgets,
      presetDashboardLayout(viewer("WAREHOUSE")),
    );
  });

  it("the stored layout wins over the preset, order included", () => {
    const resolved = resolveDashboardLayout(viewer("OWNER"), [
      { widgetId: "expected-arrivals", enabled: true, order: 0, size: "md" },
      { widgetId: "tasks", enabled: false, order: 1, size: "sm" },
    ]);
    assert.equal(resolved.source, "custom");
    assert.deepEqual(ids(resolved.widgets), ["expected-arrivals"]);
    assert.equal(resolved.widgets[0]?.size, "md");
    assert.equal(resolved.widgets[1]?.widgetId, "tasks");
  });

  it("drops a stored widget the user may no longer have, an unknown and a planned one", () => {
    const resolved = resolveDashboardLayout(viewer("SERVICE"), [
      { widgetId: "expected-arrivals", enabled: true, order: 0 }, // no purchasing.view
      { widgetId: "nope", enabled: true, order: 1 },
      { widgetId: "webshop-orders", enabled: true, order: 2 },
      { widgetId: "tasks", enabled: true, order: 3 },
    ]);
    assert.deepEqual(ids(resolved.widgets), ["tasks"]);
    for (const dropped of ["expected-arrivals", "nope", "webshop-orders"])
      assert.ok(!resolved.widgets.some((e) => e.widgetId === dropped), dropped);
    assert.deepEqual(
      resolved.widgets.map((e) => e.order),
      resolved.widgets.map((_, i) => i),
    );
  });

  it("appends a newly available widget disabled: offered, not imposed", () => {
    const resolved = resolveDashboardLayout(viewer("OWNER"), [
      { widgetId: "tasks", enabled: true, order: 0 },
    ]);
    assert.deepEqual(resolved.widgets[0], {
      widgetId: "tasks",
      enabled: true,
      order: 0,
      size: "sm",
    });
    const rest = resolved.widgets.slice(1);
    assert.ok(rest.some((e) => e.widgetId === "expected-arrivals"));
    assert.ok(
      rest.every((e) => !e.enabled),
      "a new widget is offered, not imposed",
    );
    assert.deepEqual(
      new Set(resolved.widgets.map((e) => e.widgetId)),
      new Set(availableDashboardWidgets(viewer("OWNER")).map((w) => w.id)),
    );
  });

  it("orders enabled widgets by their stored order, ignores duplicates and fixes an unsupported size", () => {
    const resolved = resolveDashboardLayout(viewer("OWNER"), [
      { widgetId: "tasks", enabled: true, order: 7, size: "lg" },
      { widgetId: "expected-arrivals", enabled: true, order: 3 },
      { widgetId: "tasks", enabled: false, order: 0 },
    ]);
    assert.deepEqual(ids(resolved.widgets), ["expected-arrivals", "tasks"]);
    assert.equal(resolved.widgets[1]?.size, "sm"); // tasks does not support lg
  });

  it("a broken stored value falls back to the preset", () => {
    for (const broken of [{}, "x", 3])
      assert.equal(
        resolveDashboardLayout(viewer("OWNER"), broken).source,
        "preset",
      );
  });
});

describe("write validation", () => {
  it("normalizes a valid layout: enabled first, orders 0..n-1", () => {
    const r = sanitizeDashboardLayoutInput(viewer("OWNER"), [
      { widgetId: "tasks", enabled: false, order: 0 },
      { widgetId: "expected-arrivals", enabled: true, order: 5, size: "md" },
    ]);
    assert.ok(r.ok);
    assert.deepEqual(
      r.widgets.map((e) => [e.widgetId, e.enabled, e.order, e.size]),
      [
        ["expected-arrivals", true, 0, "md"],
        ["tasks", false, 1, "sm"],
      ],
    );
  });

  it("refuses, by name, a widget the user may not have", () => {
    const r = sanitizeDashboardLayoutInput(viewer("SERVICE"), [
      { widgetId: "expected-arrivals", enabled: true, order: 0 },
    ]);
    assert.equal(r.ok, false);
    assert.match(
      r.ok ? "" : r.errors.join(),
      /"expected-arrivals" widget nem érhető el/,
    );
  });

  it("refuses planned, unknown, duplicate and malformed entries", () => {
    const r = sanitizeDashboardLayoutInput(viewer("OWNER"), [
      { widgetId: "webshop-orders", enabled: true, order: 0 },
      { widgetId: "nope", enabled: true, order: 0 },
      { widgetId: "tasks", enabled: true, order: 0 },
      { widgetId: "tasks", enabled: true, order: 1 },
      { widgetId: "expected-arrivals", enabled: "yes", order: -1, size: "xl" },
      "tasks",
    ]);
    assert.equal(r.ok, false);
    const text = r.ok ? "" : r.errors.join("\n");
    for (const needle of [
      'widgets[0]: a(z) "webshop-orders" widget nem érhető el',
      "widgets[1]: ismeretlen widget",
      'widgets[3]: a(z) "tasks" kétszer szerepel',
      "widgets[4].enabled",
      "widgets[4].order",
      "widgets[4].size",
      "widgets[5]: nem objektum",
    ])
      assert.ok(text.includes(needle), needle);
    assert.equal(sanitizeDashboardLayoutInput(viewer("OWNER"), {}).ok, false);
  });
});
