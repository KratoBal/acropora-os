import { render, screen, waitFor, within } from "@testing-library/react";
import type { PosSaleDetail, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotPosSaleDetailPage } from "./pilot-pos-sale-detail-page";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Tranzitíven kerül ide (`pilot-ui.tsx` ->
 * `pilot-font.ts`), lásd ugyanezt a mockot a
 * `pilot-service-job-detail-page.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A `pilot-pos-sale-detail-page.tsx` LOGIKÁJA SZÓ SZERINT A RÉGI
 * `pos-sale-detail-page.tsx`-BŐL JÖN -- lásd `pilot-pos-terminal-page.tsx`
 * fejlécét ugyanerről az elvről. Ez a fájl a régi
 * `pos-sale-detail-page.component.test.tsx` állításait ismétli a pilot
 * komponensre.
 */

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getSale: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/pos", () => ({ posApi: api }));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const saleDetail: PosSaleDetail = {
  id: "sale-1",
  orderNumber: "POS-0001",
  status: "COMPLETED",
  paymentMethod: "CASH",
  customerName: null,
  soldByName: "Acropora Tulajdonos",
  currency: "HUF",
  totalNet: "19606",
  totalTax: "5294",
  totalGross: "24900",
  discountPercent: "5",
  createdAt: "2026-07-25T10:00:00.000Z",
  completedAt: "2026-07-25T10:00:01.000Z",
  lines: [
    {
      id: "line-1",
      variantId: "variant-1",
      sku: "RS-RM500",
      productName: "Red Sea ReefMat 500",
      quantity: "1",
      unit: "db",
      unitNet: "19606",
      taxRate: "27",
      lineGross: "24900",
      discountPercent: "10",
      syncStatus: "OK",
      syncError: null,
    },
  ],
};

beforeEach(() => {
  auth.session = ownerSession;
  navigation.push.mockReset();
  api.getSale.mockReset();
});

describe("PilotPosSaleDetailPage", () => {
  it("orders.view jogosultság nélkül megtagadja a hozzáférést, és nem indul API-hívás", () => {
    auth.session = null;

    render(createElement(PilotPosSaleDetailPage, { saleId: "sale-1" }));

    expect(
      screen.getByText("Nincs hozzáférésed ehhez az eladáshoz"),
    ).toBeInTheDocument();
    expect(api.getSale).not.toHaveBeenCalled();
  });

  it("betölti és megjeleníti az eladás tételeit és összegeit", async () => {
    api.getSale.mockResolvedValue(saleDetail);

    render(createElement(PilotPosSaleDetailPage, { saleId: "sale-1" }));

    await waitFor(() =>
      expect(api.getSale).toHaveBeenCalledWith("token-owner", "sale-1"),
    );
    expect(await screen.findByText("Red Sea ReefMat 500")).toBeInTheDocument();

    // A "24 900 Ft" összeg szándékosan jelenik meg kétszer: egyszer az
    // összesítő "Bruttó" mezőjében, egyszer a tételsor "Bruttó" oszlopában
    // -- ugyanaz a kalibrált állítás, mint a régi komponens tesztjében.
    expect(screen.getAllByText(/24.900\s?Ft/)).toHaveLength(2);
    const lineRow = screen.getByRole("row", { name: /RS-RM500/ });
    expect(within(lineRow).getByText(/24.900\s?Ft/)).toBeInTheDocument();
    expect(within(lineRow).getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("API-hibát jelenít meg", async () => {
    api.getSale.mockRejectedValue(
      new Error("Az eladás betöltése nem sikerült."),
    );

    render(createElement(PilotPosSaleDetailPage, { saleId: "sale-1" }));

    expect(
      await screen.findByText("Az eladás betöltése nem sikerült."),
    ).toBeInTheDocument();
  });
});
