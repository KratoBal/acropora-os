import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  PosProductSearchResult,
  PosSaleListResponse,
  PosSaleResult,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PosTerminalPage } from "./pos-terminal-page";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  createSale: vi.fn(),
  listSales: vi.fn(),
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
// (see apps/web/src/lib/auth/production-auth.ts). OWNER has both
// orders.view and orders.manage, so this fixture covers both permissions.
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

const emptySalesResponse: PosSaleListResponse = {
  items: [],
  pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
};

const searchResult: PosProductSearchResult = {
  variantId: "variant-1",
  sku: "RS-RM500",
  productName: "Red Sea ReefMat 500",
  unit: "db",
  vatRate: "27",
  grossPrice: "24900",
  currentStock: "12",
};

function saleResult(): PosSaleResult {
  return {
    detail: {
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
      discountPercent: null,
      createdAt: "2026-07-25T10:00:00.000Z",
      completedAt: "2026-07-25T10:00:01.000Z",
      lines: [],
    },
    stockWarnings: [],
    successCount: 1,
    failedCount: 0,
  };
}

beforeEach(() => {
  auth.session = ownerSession;
  navigation.push.mockReset();
  api.searchProducts.mockReset().mockResolvedValue([]);
  api.createSale.mockReset();
  api.listSales.mockReset().mockResolvedValue(emptySalesResponse);
  api.getSale.mockReset();
});

describe("PosTerminalPage", () => {
  it("orders.view jogosultság nélkül megtagadja a hozzáférést, és nem indul API-hívás", () => {
    auth.session = null;

    render(createElement(PosTerminalPage));

    expect(
      screen.getByText("Nincs hozzáférésed a pénztárhoz"),
    ).toBeInTheDocument();
    expect(api.listSales).not.toHaveBeenCalled();
  });

  it("cookie-alapú production sessionnel (token: undefined) is elindul a mai eladások lekérése", async () => {
    auth.session = cookieSession;
    api.listSales.mockResolvedValue(emptySalesResponse);

    render(createElement(PosTerminalPage));

    await waitFor(() => expect(api.listSales).toHaveBeenCalled());
    const query = api.listSales.mock.calls[0]?.[1];
    expect(api.listSales).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        createdFrom: expect.any(String),
        createdTo: expect.any(String),
      }),
    );
    expect(new Date(query.createdFrom).getHours()).toBe(0);
    expect(
      new Date(query.createdTo).getTime() -
        new Date(query.createdFrom).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
    expect(
      await screen.findByText("Ma még nem történt eladás."),
    ).toBeInTheDocument();
  });

  it("cookie-alapú sessionnel a termékkeresés is elindítja az API-hívást", async () => {
    auth.session = cookieSession;
    api.searchProducts.mockResolvedValue([searchResult]);

    render(createElement(PosTerminalPage));
    await waitFor(() => expect(api.listSales).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    await waitFor(() =>
      expect(api.searchProducts).toHaveBeenCalledWith("", "reef"),
    );
    expect(await screen.findByText("Red Sea ReefMat 500")).toBeInTheDocument();
  });

  it("cookie-alapú sessionnel (token: undefined) a checkout/createSale is elindul", async () => {
    auth.session = cookieSession;
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PosTerminalPage));
    await waitFor(() => expect(api.listSales).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    fireEvent.click(screen.getByRole("button", { name: "Fizetés" }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          paymentMethod: "CASH",
          lines: [
            expect.objectContaining({ variantId: "variant-1", quantity: 1 }),
          ],
        }),
      ),
    );
    expect(
      await screen.findByText("Eladás rögzítve: POS-0001"),
    ).toBeInTheDocument();
  });

  it("tétel- és végösszegkedvezményt számol, majd elküldi mindkét százalékot", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Red Sea ReefMat 500 kedvezmény",
      }),
      { target: { value: "10" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Végösszeg kedvezmény" }),
      { target: { value: "20" } },
    );

    expect(screen.getByText(/17.928\s?Ft/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fizetés" }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith("token-owner", {
        paymentMethod: "CASH",
        discountPercent: 20,
        lines: [
          {
            variantId: "variant-1",
            quantity: 1,
            unitGross: 24900,
            discountPercent: 10,
          },
        ],
      }),
    );
  });
});
