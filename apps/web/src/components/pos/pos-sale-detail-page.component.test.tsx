import { render, screen, waitFor } from "@testing-library/react";
import type { PosSaleDetail, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PosSaleDetailPage } from "./pos-sale-detail-page";

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
  },
};

// Mirrors what ProductionAuthAdapter actually returns in production: a
// valid, cookie-authenticated session with no client-readable token at all
// (see apps/web/src/lib/auth/production-auth.ts).
const cookieSession: Session = {
  id: "session-cookie",
  token: undefined,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
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

describe("PosSaleDetailPage", () => {
  it("orders.view jogosultság nélkül megtagadja a hozzáférést, és nem indul API-hívás", () => {
    auth.session = null;

    render(createElement(PosSaleDetailPage, { saleId: "sale-1" }));

    expect(
      screen.getByText("Nincs hozzáférésed ehhez az eladáshoz"),
    ).toBeInTheDocument();
    expect(api.getSale).not.toHaveBeenCalled();
  });

  it("cookie-alapú production sessionnel (token: undefined) is elindul az eladás betöltése", async () => {
    auth.session = cookieSession;
    api.getSale.mockResolvedValue(saleDetail);

    render(createElement(PosSaleDetailPage, { saleId: "sale-1" }));

    await waitFor(() =>
      expect(api.getSale).toHaveBeenCalledWith("", "sale-1"),
    );
    expect(await screen.findByText("Red Sea ReefMat 500")).toBeInTheDocument();
    expect(screen.getByText(/24.900\s?Ft/)).toBeInTheDocument();
  });

  it("API-hibát jelenít meg cookie-alapú sessionnel is", async () => {
    auth.session = cookieSession;
    api.getSale.mockRejectedValue(new Error("Az eladás betöltése nem sikerült."));

    render(createElement(PosSaleDetailPage, { saleId: "sale-1" }));

    expect(
      await screen.findByText("Az eladás betöltése nem sikerült."),
    ).toBeInTheDocument();
  });
});
