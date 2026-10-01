import type { DashboardLayoutEntry } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  applyStarterLayout,
  enabledWidgets,
  layoutUpdate,
  moveWidget,
  toggleWidget,
} from "./layout-edit";

const layout: DashboardLayoutEntry[] = [
  { widgetId: "tasks", enabled: true, order: 0, size: "sm" },
  { widgetId: "expected-arrivals", enabled: true, order: 1, size: "sm" },
  { widgetId: "service-tickets", enabled: false, order: 2, size: "sm" },
];

const enabledIds = (entries: DashboardLayoutEntry[]) =>
  enabledWidgets(entries).map((e) => e.widgetId);

describe("a testreszabás szerkesztései", () => {
  it("bekapcsolt widget a bekapcsoltak végére kerül", () => {
    const next = toggleWidget(layout, "service-tickets");
    expect(enabledIds(next)).toEqual([
      "tasks",
      "expected-arrivals",
      "service-tickets",
    ]);
    expect(next.map((e) => e.order)).toEqual([0, 1, 2]);
  });

  it("kikapcsolt widget kikerül a látható sorból, de a listában marad", () => {
    const next = toggleWidget(layout, "tasks");
    expect(enabledIds(next)).toEqual(["expected-arrivals"]);
    expect(next.find((e) => e.widgetId === "tasks")?.enabled).toBe(false);
    expect(next).toHaveLength(3);
  });

  it("fel és le mozgat, a széleken nem lép ki", () => {
    expect(enabledIds(moveWidget(layout, "expected-arrivals", -1))).toEqual([
      "expected-arrivals",
      "tasks",
    ]);
    expect(enabledIds(moveWidget(layout, "tasks", -1))).toEqual([
      "tasks",
      "expected-arrivals",
    ]);
    expect(enabledIds(moveWidget(layout, "expected-arrivals", 1))).toEqual([
      "tasks",
      "expected-arrivals",
    ]);
  });

  it("ismeretlen widgetet nem talál ki", () => {
    expect(toggleWidget(layout, "webshop-orders")).toEqual(layout);
  });

  it("a mentés teste a teljes sorrendet viszi", () => {
    expect(layoutUpdate(layout).widgets.map((w) => w.order)).toEqual([0, 1, 2]);
  });
});

describe("induló elrendezés", () => {
  it("a sajátjait bekapcsolja a saját sorrendjében, a többit kikapcsolja", () => {
    const next = applyStarterLayout(layout, ["service-tickets", "tasks"]);
    expect(enabledIds(next)).toEqual(["service-tickets", "tasks"]);
    expect(next.find((e) => e.widgetId === "expected-arrivals")?.enabled).toBe(
      false,
    );
  });

  it("a listában nem szereplő (nem elérhető) widgetet nem veszi fel", () => {
    const next = applyStarterLayout(layout, ["webshop-orders", "tasks"]);
    expect(enabledIds(next)).toEqual(["tasks"]);
    expect(next).toHaveLength(3);
  });
});
