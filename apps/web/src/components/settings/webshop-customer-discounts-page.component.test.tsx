import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopCustomerDiscount } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopCustomerDiscountsPage } from "./webshop-customer-discounts-page";

/*
  A VEVŐNKÉNTI KEDVEZMÉNY OLDALA (kártya 20713f62). MI PIROSÍT: vevő kiválasztása nélkül vagy rossz százalékkal az API-ig jut
  a mentés; a mentés nem a kiválasztott vevővel és a beírt százalékkal megy; a lista nem frissül; a kapcsoló nem a fordított
  állapotot kéri; a beállítások joga nélkül a lap működik.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  searchCustomers: vi.fn(),
  set: vi.fn(),
  setActive: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "WAREHOUSE" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token",
      user: {
        id: "u",
        email: "u@acropora.local",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    },
    isLoading: false,
  }),
}));
vi.mock("@/lib/api/webshop-customer-discounts", () => ({
  webshopCustomerDiscountsApi: api,
}));

const discount = (
  over: Partial<WebshopCustomerDiscount> = {},
): WebshopCustomerDiscount => ({
  id: "promo_p",
  customerId: "cus_01JABCDEF123",
  customerEmail: "anna@example.test",
  customerName: "Teszt Anna",
  percent: 7,
  active: true,
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  api.list
    .mockReset()
    .mockResolvedValue({ discounts: [discount()], truncated: false });
  api.searchCustomers
    .mockReset()
    .mockResolvedValue([
      {
        id: "cus_01JBBBBBBB99",
        email: "bela@example.test",
        name: "Minta Béla",
        hasAccount: true,
      },
    ]);
  api.set.mockReset();
  api.setActive.mockReset();
});

describe("WebshopCustomerDiscountsPage", () => {
  it("lists the discounts by customer, without any group", async () => {
    render(createElement(WebshopCustomerDiscountsPage));
    expect(
      await screen.findByText("Teszt Anna · anna@example.test"),
    ).toBeTruthy();
    expect(screen.getByText("7%")).toBeTruthy();
    expect(screen.queryByText(/csoport/i)).toBeNull();
  });

  it("without a chosen customer or with a bad percent the save stops at the form", async () => {
    render(createElement(WebshopCustomerDiscountsPage));
    await screen.findByText("7%");
    fireEvent.change(screen.getByLabelText("Kedvezmény százaléka"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kedvezmény mentése" }));
    expect(await screen.findByText("Válassz vevőt a keresőből.")).toBeTruthy();
    expect(screen.getByText(/egész százalék 1 és 100 között/)).toBeTruthy();
    expect(api.set).not.toHaveBeenCalled();
  });

  it("search, choose, save: the chosen customer and the typed percent go, and the list shows it", async () => {
    api.set.mockImplementation(async (_t, input) =>
      discount({
        id: "promo_b",
        customerId: input.customerId,
        customerEmail: "bela@example.test",
        customerName: "Minta Béla",
        percent: input.percent,
      }),
    );
    render(createElement(WebshopCustomerDiscountsPage));
    await screen.findByText("7%");
    fireEvent.change(screen.getByLabelText("Vevő keresése"), {
      target: { value: "bela" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Keresés" }));
    await waitFor(() =>
      expect(api.searchCustomers).toHaveBeenCalledWith("token", "bela"),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kiválasztás: bela@example.test",
      }),
    );
    fireEvent.change(screen.getByLabelText("Kedvezmény százaléka"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kedvezmény mentése" }));
    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith("token", {
        customerId: "cus_01JBBBBBBB99",
        percent: 10,
      }),
    );
    expect(
      await screen.findByText("Minta Béla · bela@example.test: 10% beállítva."),
    ).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
  });

  it("the switch asks for the opposite state", async () => {
    api.setActive.mockResolvedValue(discount({ active: false }));
    render(createElement(WebshopCustomerDiscountsPage));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Teszt Anna · anna@example.test: kikapcsolás",
      }),
    );
    await waitFor(() =>
      expect(api.setActive).toHaveBeenCalledWith("token", "promo_p", false),
    );
    expect(await screen.findByText("Kikapcsolva")).toBeTruthy();
  });

  it("without the settings permission there is neither list nor form", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(WebshopCustomerDiscountsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a kedvezményekhez"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Kedvezmény mentése" }),
    ).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });
});
