import { render, screen } from "@testing-library/react";
import type { DashboardSummary } from "@acropora/types";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/pilot/pilot-ui", async () => {
  const ui = await import("@acropora/ui");
  return {
    PilotBadge: ui.PilotBadge,
    PilotCard: ui.PilotCard,
    PilotCardHeader: ui.PilotCardHeader,
    PilotThemeRoot: ({ children }: { children: ReactNode }) => children,
  };
});

import { DashboardCards } from "./page";

describe("DashboardCards", () => {
  it("csak a válaszban kapott kulcsokhoz rajzol kártyát", () => {
    const summary: DashboardSummary = {
      myWorksheets: {
        items: [
          {
            id: "worksheet-1",
            number: "ML-1",
            subject: "Szivattyú ellenőrzése",
            status: "DRAFT",
            deadline: "2026-09-26",
          },
        ],
      },
      inventoryDiscrepancies: {
        count: 1,
        items: [
          {
            variantId: "variant-1",
            sku: "SKU-1",
            warehouseCode: "BP",
            status: "SYNC_FAILED",
          },
        ],
      },
    };

    render(<DashboardCards summary={summary} />);

    expect(
      screen.getByRole("heading", { name: "Saját munkalapjaim" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leltár" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Akváriumok" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Határidők" }),
    ).not.toBeInTheDocument();
  });

  it("az üres, de engedélyezett kártyán megmutatja az üres állapotot", () => {
    const summary: DashboardSummary = {
      myWorksheets: { items: [] },
      openTickets: { count: 0, items: [] },
      aquariumAlerts: { staleAfterDays: 14, items: [] },
    };

    render(<DashboardCards summary={summary} />);

    expect(screen.getByText("Nincs nyitott munkalapod.")).toBeInTheDocument();
    expect(
      screen.getByText("Nincs nyitott hibajegy a helyszíneiden."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nincs figyelmeztető akváriumjelzés."),
    ).toBeInTheDocument();
  });

  it("nem rajzol beszerzési kártyát akkor sem, ha a régi válasz még tartalmazza", () => {
    const summary: DashboardSummary = {
      purchasing: {
        items: [
          {
            id: "purchase-1",
            orderNumber: "PO-1",
            supplierName: "Beszállító Kft.",
            status: "OPEN",
            expectedAt: "2026-09-30T00:00:00.000Z",
          },
        ],
      },
    };

    render(<DashboardCards summary={summary} />);

    expect(
      screen.queryByRole("heading", { name: "Beszerzés" }),
    ).not.toBeInTheDocument();
  });
});
