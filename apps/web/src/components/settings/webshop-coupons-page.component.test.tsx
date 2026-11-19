import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopCoupon } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopCouponsPage } from "./webshop-coupons-page";

/*
  A KUPONOK OLDALA (kártya 393ae5cb). MI PIROSÍT: egy hibás kupon az API-ig jut (a mezőhiba nem látszik); a jó kupon nem a
  megadott értékekkel megy el, vagy nem kerül a lista elejére; a kapcsoló nem a fordított állapotot kéri; a beállítások
  joga nélkül a lista vagy az űrlap megjelenik.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
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
vi.mock("@/lib/api/webshop-coupons", () => ({ webshopCouponsApi: api }));

const coupon = (over: Partial<WebshopCoupon> = {}): WebshopCoupon => ({
  id: "promo_1",
  code: "TAVASZ10",
  kind: "PERCENT",
  value: 10,
  validFrom: "2026-03-01",
  validUntil: "2026-03-31",
  usageLimit: 10,
  used: 3,
  state: "ACTIVE",
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  api.list
    .mockReset()
    .mockResolvedValue({ coupons: [coupon()], truncated: false });
  api.create.mockReset();
  api.setActive.mockReset();
});

describe("WebshopCouponsPage", () => {
  it("lists the coupons with their discount, window, uses and state", async () => {
    render(createElement(WebshopCouponsPage));
    expect(await screen.findByText("TAVASZ10")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    expect(screen.getByText("2026-03-01 – 2026-03-31")).toBeTruthy();
    expect(screen.getByText("3 / 10")).toBeTruthy();
    expect(screen.getByText("Aktív")).toBeTruthy();
  });

  it("a bad coupon stops at the form with its field error, and the API is not called", async () => {
    render(createElement(WebshopCouponsPage));
    await screen.findByText("TAVASZ10");
    fireEvent.change(screen.getByLabelText("Kód"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Kedvezmény értéke"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kupon felvétele" }));
    expect(await screen.findByText(/A kód 3-40 karakter/)).toBeTruthy();
    expect(screen.getByText(/A százalék egész szám/)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("a good coupon goes with the typed values, and lands at the top of the list", async () => {
    api.create.mockImplementation(async (_token, input) =>
      coupon({
        id: "promo_2",
        code: input.code,
        kind: input.kind,
        value: input.value,
        validFrom: null,
        validUntil: null,
        usageLimit: null,
        used: 0,
      }),
    );
    render(createElement(WebshopCouponsPage));
    await screen.findByText("TAVASZ10");
    fireEvent.change(screen.getByLabelText("Kód"), {
      target: { value: "ezer-ft" },
    });
    fireEvent.change(screen.getByLabelText("Kedvezmény fajtája"), {
      target: { value: "AMOUNT" },
    });
    fireEvent.change(screen.getByLabelText("Kedvezmény értéke"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kupon felvétele" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith("token", {
      code: "EZER-FT",
      kind: "AMOUNT",
      value: 1000,
      validFrom: null,
      validUntil: null,
      usageLimit: null,
    });
    expect(await screen.findByText("A(z) EZER-FT kupon felvéve.")).toBeTruthy();
    const codes = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);
    expect(codes).toEqual(["EZER-FT", "TAVASZ10"]);
  });

  it("the switch asks for the opposite state, and shows the answer", async () => {
    api.setActive.mockResolvedValue(coupon({ state: "INACTIVE" }));
    render(createElement(WebshopCouponsPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "TAVASZ10: kikapcsolás" }),
    );
    await waitFor(() =>
      expect(api.setActive).toHaveBeenCalledWith("token", "promo_1", false),
    );
    expect(await screen.findByText("Kikapcsolva")).toBeTruthy();
  });

  it("without the settings permission there is neither list nor form", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(WebshopCouponsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a kuponokhoz"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Kupon felvétele" }),
    ).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });
});
