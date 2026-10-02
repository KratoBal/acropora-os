import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DashboardLayoutResponse,
  DashboardWidgetsResponse,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/pilot/pilot-ui", async () => {
  const ui = await import("@acropora/ui");
  return { PilotButton: ui.PilotButton, PilotDrawer: ui.PilotDrawer };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "",
      user: { id: "u1", role: "OWNER", displayName: "Teszt Elek" },
    },
  }),
}));

const api = vi.hoisted(() => ({
  layout: vi.fn(),
  widgets: vi.fn(),
  saveLayout: vi.fn(),
  resetLayout: vi.fn(),
}));
vi.mock("@/lib/api/dashboard", () => ({ dashboardApi: api }));

import { DashboardHome } from "./dashboard-home";

const layout = (
  over: Partial<DashboardLayoutResponse> = {},
): DashboardLayoutResponse => ({
  source: "preset",
  widgets: [
    { widgetId: "tasks", enabled: true, order: 0, size: "sm" },
    { widgetId: "expected-arrivals", enabled: true, order: 1, size: "sm" },
  ],
  available: [
    {
      id: "tasks",
      title: "Feladataim",
      description: "Személyes teendők",
      category: "tasks",
      defaultSize: "sm",
      supportedSizes: ["sm", "md"],
    },
    {
      id: "expected-arrivals",
      title: "Várható beérkezések",
      description: "Bevételezésre váró szállítmányok",
      category: "purchasing",
      defaultSize: "sm",
      supportedSizes: ["sm", "md"],
    },
  ],
  starterLayouts: [],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
});

async function renderHome() {
  await act(async () => {
    render(<DashboardHome />);
  });
}

describe("a testreszabható vezérlőpult", () => {
  it("egyetlen csoportos kérésben kéri a bekapcsolt widgetek adatát, és kirajzolja őket", async () => {
    api.layout.mockResolvedValue(layout());
    api.widgets.mockResolvedValue({
      results: {
        tasks: {
          status: "ok",
          data: {
            openCount: 2,
            latest: [
              {
                id: "t1",
                title: "Kitalált teendő",
                createdAt: "2026-09-30T08:00:00Z",
              },
            ],
          },
        },
        "expected-arrivals": {
          status: "ok",
          data: {
            count: 0,
            byStage: { PROFORMA: 0, INVOICE: 0, LATE_CORRECTION: 0 },
            latest: [],
          },
        },
      },
    } satisfies DashboardWidgetsResponse);
    await renderHome();

    expect(api.widgets).toHaveBeenCalledTimes(1);
    expect(api.widgets.mock.calls[0]?.[1]).toEqual([
      "tasks",
      "expected-arrivals",
    ]);
    expect(screen.getByText("2 AKTÍV WIDGET")).toBeTruthy();
    const tasks = screen.getByRole("region", { name: "Feladataim" });
    expect(within(tasks).getByText("Kitalált teendő")).toBeTruthy();
    const arrivals = screen.getByRole("region", {
      name: "Várható beérkezések",
    });
    expect(
      within(arrivals).getByText("Nincs bevételezésre váró szállítmány."),
    ).toBeTruthy();
  });

  it("hibás widget a hibaüzenetet mutatja, nem nullát; a többi widget nem dől el vele", async () => {
    api.layout.mockResolvedValue(layout());
    api.widgets.mockResolvedValue({
      results: {
        tasks: { status: "error", message: "Az adat jelenleg nem elérhető." },
        "expected-arrivals": {
          status: "ok",
          data: {
            count: 1,
            byStage: { PROFORMA: 1, INVOICE: 0, LATE_CORRECTION: 0 },
            latest: [
              {
                supplierName: "Kitalált Kft.",
                stage: "PROFORMA",
                arrivedAt: null,
              },
            ],
          },
        },
      },
    });
    await renderHome();

    const tasks = screen.getByRole("region", { name: "Feladataim" });
    expect(
      within(tasks).getByText("Az adat jelenleg nem elérhető."),
    ).toBeTruthy();
    expect(within(tasks).queryByText("0")).toBeNull();
    const arrivals = screen.getByRole("region", {
      name: "Várható beérkezések",
    });
    expect(within(arrivals).getByText("Kitalált Kft.")).toBeTruthy();
  });

  it("ha az egész adatkérés elbukik, minden kártya hibát mutat, nem nullát", async () => {
    api.layout.mockResolvedValue(layout());
    api.widgets.mockRejectedValue(new Error("synthetic network failure"));
    await renderHome();

    expect(screen.getAllByText("Az adat jelenleg nem elérhető.")).toHaveLength(
      2,
    );
    expect(screen.queryByText("0")).toBeNull();
  });

  it("amit a szerver tiltottnak mond, az a kártyát sem rajzolja ki", async () => {
    api.layout.mockResolvedValue(layout());
    api.widgets.mockResolvedValue({
      results: {
        tasks: { status: "ok", data: { openCount: 0, latest: [] } },
        "expected-arrivals": { status: "forbidden" },
      },
    });
    await renderHome();

    expect(screen.getByRole("region", { name: "Feladataim" })).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Várható beérkezések" }),
    ).toBeNull();
  });

  it("a testreszabás csak az elérhető widgeteket kínálja, és a kikapcsolást menti", async () => {
    const user = userEvent.setup();
    api.layout.mockResolvedValue(layout());
    api.widgets.mockResolvedValue({ results: {} });
    api.saveLayout.mockResolvedValue(
      layout({
        source: "custom",
        widgets: [
          {
            widgetId: "expected-arrivals",
            enabled: true,
            order: 0,
            size: "sm",
          },
          { widgetId: "tasks", enabled: false, order: 1, size: "sm" },
        ],
      }),
    );
    await renderHome();

    await user.click(
      screen.getByRole("button", { name: /Vezérlőpult testreszabása/ }),
    );
    const drawer = screen.getByRole("dialog");
    // only the two available widgets, nothing from the registry beyond them
    expect(within(drawer).getAllByRole("switch")).toHaveLength(2);
    expect(within(drawer).queryByText("Webshop rendelési sor")).toBeNull();

    await user.click(
      within(drawer).getByRole("switch", { name: "Feladataim megjelenítése" }),
    );
    await user.click(within(drawer).getByRole("button", { name: "Mentés" }));

    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    expect(api.saveLayout.mock.calls[0]?.[1]).toEqual({
      widgets: [
        { widgetId: "expected-arrivals", enabled: true, order: 0, size: "sm" },
        { widgetId: "tasks", enabled: false, order: 1, size: "sm" },
      ],
    });
    expect(await screen.findByText("1 AKTÍV WIDGET")).toBeTruthy();
  });

  it("az ajánlott elrendezés visszaállítása a szerveren törli a sajátot", async () => {
    const user = userEvent.setup();
    api.layout.mockResolvedValue(layout({ source: "custom" }));
    api.widgets.mockResolvedValue({ results: {} });
    api.resetLayout.mockResolvedValue(layout());
    await renderHome();

    expect(screen.getByText(/Személyes elrendezés/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: /Vezérlőpult testreszabása/ }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Ajánlott elrendezés visszaállítása",
      }),
    );
    // it asks first: the own layout is lost
    expect(api.resetLayout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Visszaállítás" }));
    expect(api.resetLayout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Tulajdonos · Ajánlott elrendezés/),
    ).toBeTruthy();
  });

  it("bekapcsolt widget nélkül nem kér adatot, és megmondja, hol lehet választani", async () => {
    api.layout.mockResolvedValue(
      layout({
        widgets: [
          { widgetId: "tasks", enabled: false, order: 0, size: "sm" },
          {
            widgetId: "expected-arrivals",
            enabled: false,
            order: 1,
            size: "sm",
          },
        ],
      }),
    );
    await renderHome();

    expect(api.widgets).not.toHaveBeenCalled();
    expect(screen.getByText(/Nincs bekapcsolt widget/)).toBeTruthy();
  });
  it("a testreszabás teste maga görget, így a lista alja is elérhető (Balázs, 2026-10-02)", async () => {
    // The drawer locks the page scroll and is a full-height flex column:
    // without its own scroll container the bottom of the list is cut off.
    api.layout.mockResolvedValue(layout());
    api.widgets.mockResolvedValue({ results: {} });
    const user = userEvent.setup();
    await renderHome();
    await user.click(
      screen.getByRole("button", { name: /Vezérlőpult testreszabása/ }),
    );
    const body = within(screen.getByRole("dialog")).getByTestId(
      "customize-drawer-body",
    );
    for (const cls of ["overflow-y-auto", "flex-1", "min-h-0"])
      expect(body.className.split(/\s+/)).toContain(cls);
  });
});
