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

import { PilotPosTerminalPage } from "./pilot-pos-terminal-page";

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
 * A `pilot-pos-terminal-page.tsx` LOGIKÁJA SZÓ SZERINT A RÉGI
 * `pos-terminal-page.tsx`-BŐL JÖN (lásd annak fejlécét) -- ez a fájl ezért
 * a régi `pos-terminal-page.component.test.tsx` szűkített, a Figma-kör
 * brief-je szerint kért állításait ismétli a PILOT komponensre: a
 * "Fizetés" gomb csak `orders.manage` joggal látszik, és a kosár összege a
 * tételek és a kedvezmények szerint számol. Nem duplikálja a régi fájl
 * TELJES lefedettségét (pl. cookie-session ág), mert az az ÉRINTETLEN régi
 * komponenst teszteli, nem ezt.
 */

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

function sessionWithRole(role: "OWNER" | "WAREHOUSE"): Session {
  return {
    id: `session-${role}`,
    token: `token-${role}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: role,
      email: `${role.toLowerCase()}@acropora.local`,
      displayName: "Teszt Felhasználó",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

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
      soldByName: "Teszt Felhasználó",
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
  auth.session = sessionWithRole("OWNER");
  navigation.push.mockReset();
  api.searchProducts.mockReset().mockResolvedValue([]);
  api.createSale.mockReset();
  api.listSales.mockReset().mockResolvedValue(emptySalesResponse);
  api.getSale.mockReset();
});

describe("PilotPosTerminalPage", () => {
  it("orders.view jogosultság nélkül megtagadja a hozzáférést", () => {
    auth.session = null;

    render(createElement(PilotPosTerminalPage));

    expect(
      screen.getByText("Nincs hozzáférésed a pénztárhoz"),
    ).toBeInTheDocument();
    expect(api.listSales).not.toHaveBeenCalled();
  });

  /**
   * A WAREHOUSE SZEREPNEK VAN `orders.view`-JA, DE NINCS `orders.manage`-JE
   * (packages/types/src/auth.ts) -- ez a fixture ezt a szétválasztást
   * használja ki: a lap MEGNYÍLIK (látja a keresést, a kosarat), de a
   * "Fizetés" gomb NEM jelenik meg. MI PIROSÍT: ha a gomb feltétel nélkül
   * renderelne.
   */
  it("orders.manage jog nélkül a lap megnyílik, de a Fizetés gomb nem jelenik meg", async () => {
    auth.session = sessionWithRole("WAREHOUSE");

    render(createElement(PilotPosTerminalPage));

    await waitFor(() => expect(api.listSales).toHaveBeenCalled());
    expect(
      screen.getByRole("textbox", { name: "Termék keresése" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fizetés" }),
    ).not.toBeInTheDocument();
  });

  it("orders.manage joggal a Fizetés gomb megjelenik, és rögzíti az eladást", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
    await waitFor(() => expect(api.listSales).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "Fizetés" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(screen.getByRole("button", { name: "Fizetés" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Fizetés" }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith(
        "token-OWNER",
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

  /**
   * A MAI KÉPLET: soronként `unitGross * quantity * (1 - lineDiscount/100)`,
   * összegezve, majd a teljes összegre `* (1 - overallDiscount/100)` --
   * lásd a régi komponens `subtotalGross`/`totalGross`-át. 24900 Ft egy
   * darabon 10%-os tételkedvezménnyel 22410, majd 20%-os végösszeg-
   * kedvezménnyel 17928 -- ugyanaz a szám, amit a régi teszt is ellenőriz.
   */
  it("a tétel- és a végösszeg-kedvezményt is a mai képlet szerint számítja, és mindkettőt elküldi", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
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
      expect(api.createSale).toHaveBeenCalledWith("token-OWNER", {
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

  it("a fizetési mód szegmentált gombjai a helyes CASH/CARD/TRANSFER értéket küldik", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    fireEvent.click(screen.getByRole("button", { name: "Utalás" }));
    fireEvent.click(screen.getByRole("button", { name: "Fizetés" }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith(
        "token-OWNER",
        expect.objectContaining({ paymentMethod: "TRANSFER" }),
      ),
    );
  });
});
