import { render, screen } from "@testing-library/react";
import type { DashboardSummary } from "@acropora/types";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/pilot/pilot-ui", async () => {
  const ui = await import("@acropora/ui");
  return {
    PilotAvatar: ui.PilotAvatar,
    PilotBadge: ui.PilotBadge,
    PilotCard: ui.PilotCard,
    PilotCardHeader: ui.PilotCardHeader,
    PilotThemeRoot: ({ children }: { children: ReactNode }) => children,
    pilotAvatarColor: ui.pilotAvatarColor,
    pilotInitials: ui.pilotInitials,
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
    expect(
      screen.getByRole("heading", { name: "Leltár – eltérések" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Akváriumok – figyelmeztetések" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Határidők" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Esedékes karbantartások" }),
    ).not.toBeInTheDocument();
  });

  it("az üres, de engedélyezett kártyán megmutatja az üres állapotot", () => {
    const summary: DashboardSummary = {
      myWorksheets: { items: [] },
      openTickets: { count: 0, items: [] },
      upcomingMaintenance: { items: [] },
      aquariumAlerts: { staleAfterDays: 14, items: [] },
    };

    render(<DashboardCards summary={summary} />);

    expect(screen.getByText("Nincs nyitott munkalapod.")).toBeInTheDocument();
    expect(
      screen.getByText("Nincs nyitott hibajegy a helyszíneiden."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nincs esedékes karbantartás."),
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

  /**
   * FIGMA-IGAZÍTÁS (2026-09-25): az "Esedékes karbantartások" kártya, a
   * `nextServiceAt`-ből számolt "X nap"/"X napja lejárt" jelzővel -- lásd a
   * `daysUntil`/`DaysPill` fejlécét ugyanebben a fájlban.
   */
  it("az esedékes karbantartások kártya a napok számát mutatja, közelgőt és lejártat is", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const past = new Date();
    past.setDate(past.getDate() - 2);

    const summary: DashboardSummary = {
      upcomingMaintenance: {
        items: [
          {
            assetId: "asset-1",
            assetName: "Szivattyú",
            customerName: "Fővárosi Állat- és Növénykert",
            departmentName: "Akvárium ház",
            nextServiceAt: soon.toISOString().slice(0, 10),
          },
          {
            assetId: "asset-2",
            assetName: "UV-lámpa",
            customerName: null,
            departmentName: "Saját raktár",
            nextServiceAt: past.toISOString().slice(0, 10),
          },
        ],
      },
    };

    render(<DashboardCards summary={summary} />);

    expect(
      screen.getByRole("heading", { name: "Esedékes karbantartások" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Szivattyú")).toBeInTheDocument();
    expect(screen.getByText("3 nap")).toBeInTheDocument();
    expect(screen.getByText("2 napja lejárt")).toBeInTheDocument();
  });

  /**
   * A CSAPAT KÁRTYA CÍME TELJES ALAKBAN, ÉS AVATÁRRAL/SÁVVAL RAJZOL --
   * korábban csak a nevet és a számot írta ki.
   */
  it("a csapat kártya avatárral és a nyitott munkalapok szerinti sávval rajzol", () => {
    const summary: DashboardSummary = {
      teamLoad: {
        items: [
          { userId: "u1", displayName: "Tóth Gábor", openWorksheetCount: 4 },
          { userId: "u2", displayName: "Nagy Diána", openWorksheetCount: 1 },
        ],
      },
    };

    render(<DashboardCards summary={summary} />);

    expect(
      screen.getByRole("heading", { name: "Csapat – nyitott munkalapok" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tóth Gábor")).toBeInTheDocument();
    expect(screen.getByText("4 nyitott")).toBeInTheDocument();
    expect(screen.getByText("1 nyitott")).toBeInTheDocument();
  });

  /**
   * A NÉGY CSEMPE A TERV RÖVID FELIRATÁVAL RAJZOL ("Nyitott hibajegy", nem
   * "Nyitott hibajegyek") -- lásd `ManagerTiles`/`MANAGER_TILE_STYLE`.
   */
  it("a szerviz-áttekintő csempék a terv rövid feliratával rajzolnak", () => {
    const summary: DashboardSummary = {
      managerTiles: {
        openTickets: 7,
        worksheetsWaitingForSignature: 3,
        materialRequestsWaiting: 2,
        maintenanceOrderFormsWaitingForSignature: 1,
      },
    };

    render(<DashboardCards summary={summary} />);

    expect(screen.getByText("Nyitott hibajegy")).toBeInTheDocument();
    expect(screen.getByText("Aláírásra vár")).toBeInTheDocument();
    expect(screen.getByText("Anyagigény")).toBeInTheDocument();
    expect(screen.getByText("Megrendelőlap")).toBeInTheDocument();
  });
});
