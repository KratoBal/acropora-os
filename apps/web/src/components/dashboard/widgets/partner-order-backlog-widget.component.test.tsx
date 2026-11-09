import { render, screen } from "@testing-library/react";
import type { DashboardPartnerOrderBacklogWidgetData } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { DASHBOARD_WIDGET_VIEWS } from "./index";
import { partnerOrderBacklogWidget } from "./partner-order-backlog-widget";

/*
  A HATRALEKOS MEGRENDELESEK KARTYAJA (S4b-2, 38caeac2). MI PIROSIT: ha a szam vagy a nyugvo napok nem latszanak; ha a
  megrendeles szama a vevo nelkul is kiteszi a ' · ' elvalasztot; ha a kartya nem a szurt listara visz; ha nulla
  hatralek mellett nincs kimondott ures allapot, vagy hatralek mellett van; ha az aktiv kartyahoz nincs nezet.
*/
const data = (
  over: Partial<DashboardPartnerOrderBacklogWidgetData> = {},
): DashboardPartnerOrderBacklogWidgetData => ({
  count: 3,
  backlogDays: 14,
  oldest: [
    {
      orderId: "o1",
      orderNumber: "MR-2026-0042",
      customerName: "Teszt Állatkert",
      idleDays: 30,
    },
    {
      orderId: "o2",
      orderNumber: "MR-2026-0043",
      customerName: null,
      idleDays: 15,
    },
  ],
  ...over,
});

describe("the back-ordered orders card", () => {
  it("shows the count with the set days, and each long standing order with its idle days", () => {
    const { Body } = partnerOrderBacklogWidget;
    render(<Body data={data()} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByText("hátralékos megrendelés (14 napja nincs mozgás)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("MR-2026-0042 · Teszt Állatkert"),
    ).toBeInTheDocument();
    expect(screen.getByText("30 napja")).toBeInTheDocument();
  });

  it("an order with no customer shows its number alone, without a dangling separator", () => {
    const { Body } = partnerOrderBacklogWidget;
    render(<Body data={data()} />);
    expect(screen.getByText("MR-2026-0043")).toBeInTheDocument();
    expect(screen.queryByText(/MR-2026-0043 ·/)).not.toBeInTheDocument();
  });

  it("links to the list filtered on the backlog", () => {
    expect(partnerOrderBacklogWidget.href).toBe("/megrendelesek?backlog=1");
  });

  it("says there is nothing only when there is nothing", () => {
    expect(
      partnerOrderBacklogWidget.emptyMessage(data({ count: 0, oldest: [] })),
    ).toBe("Nincs hátralékos megrendelés.");
    expect(partnerOrderBacklogWidget.emptyMessage(data())).toBeNull();
  });

  it("is registered as the view of its registry entry", () => {
    expect(DASHBOARD_WIDGET_VIEWS["partner-order-backlog"]).toBe(
      partnerOrderBacklogWidget,
    );
  });
});
