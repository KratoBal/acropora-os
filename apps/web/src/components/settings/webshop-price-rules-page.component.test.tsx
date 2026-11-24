import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopPriceRules } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopPriceRulesPage } from "./webshop-price-rules-page";

/*
  A HŰSÉGPONT ÉS ÁRSZABÁLYOK LAPJA (acrobot 60467; commerce #880, #881). MI PIROSÍT: a kapcsoló nem 0 vagy 1 alakban megy; egy
  határon kívüli érték (14 napos Omnibus-küszöb) az API-ig jut; az értékek nem a beírt számokkal mennek; az érték forrása
  vagy a hiányzó érték nem látszik; a beállítások joga nélkül a lap betölt.
*/
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
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
vi.mock("@/lib/api/webshop-price-rules", () => ({
  webshopPriceRulesApi: api,
}));

const rules = (over: Partial<WebshopPriceRules> = {}): WebshopPriceRules => ({
  values: {
    loyaltyAccrualEnabled: 0,
    loyaltyAccrualPercent: 3,
    loyaltyAccrualOnSaleItems: 0,
    loyaltyRedemptionEnabled: 0,
    loyaltyPointValueHuf: 1,
    loyaltyMinOrderHuf: 30000,
    loyaltyMinPoints: null,
    loyaltyMaxPercent: 40,
    omnibusMinHistoryDays: 15,
  },
  sources: {
    loyaltyAccrualEnabled: "row",
    loyaltyAccrualPercent: "row",
    loyaltyAccrualOnSaleItems: "row",
    loyaltyRedemptionEnabled: "default",
    loyaltyPointValueHuf: "default",
    loyaltyMinOrderHuf: "default",
    loyaltyMinPoints: "default",
    loyaltyMaxPercent: "env",
    omnibusMinHistoryDays: "row",
  },
  ...over,
});

const OMNIBUS =
  "Legalább ennyi napos ár-előzmény (15 és 30 között; a 15 a rendelet alsó határa)";

beforeEach(() => {
  auth.role = "OWNER";
  api.get.mockReset().mockResolvedValue(rules());
  api.save.mockReset();
});

describe("WebshopPriceRulesPage", () => {
  it("shows the values in their sections, and where each comes from: unset, default, the shop's environment", async () => {
    render(createElement(WebshopPriceRulesPage));
    expect(
      ((await screen.findByLabelText(OMNIBUS)) as HTMLInputElement).value,
    ).toBe("15");
    expect(
      screen.getByRole("heading", { name: "Hűségpont gyűjtése" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Hűségpont beváltása" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Árcsökkentés közlése (Omnibus)" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Pontbeváltás a pénztárban") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (
        screen.getByLabelText(
          "Egyszerre legalább ennyi pont váltható be",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(screen.getByText("A webshopban nincs beállítva.")).toBeTruthy();
    expect(screen.getAllByText("A webshop alapértéke.")).toHaveLength(3);
    expect(
      screen.getByText(
        "A webshop környezeti beállításából jön; csak akkor íródik felül, ha itt megváltoztatod.",
      ),
    ).toBeTruthy();
  });

  it("a value outside its bounds stops at the form; the switch goes as 1, the numbers as typed", async () => {
    api.save.mockImplementation(async (_t, values) => rules({ values }));
    render(createElement(WebshopPriceRulesPage));
    await screen.findByLabelText(OMNIBUS);
    fireEvent.change(
      screen.getByLabelText("Egyszerre legalább ennyi pont váltható be"),
      { target: { value: "100" } },
    );
    fireEvent.change(screen.getByLabelText(OMNIBUS), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Egész szám 15 és 30 között.")).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(OMNIBUS), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByLabelText("Pontbeváltás a pénztárban"));
    fireEvent.click(
      screen.getByLabelText("Pontgyűjtés a lezárt rendelés után"),
    );
    fireEvent.change(
      screen.getByLabelText(
        "A tételek bruttó értékének ennyi százaléka jár pontban (0: nem jár pont)",
      ),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith("token", {
        loyaltyAccrualEnabled: 1,
        loyaltyAccrualPercent: 5,
        loyaltyAccrualOnSaleItems: 0,
        loyaltyRedemptionEnabled: 1,
        loyaltyPointValueHuf: 1,
        loyaltyMinOrderHuf: 30000,
        loyaltyMinPoints: 100,
        loyaltyMaxPercent: 40,
        omnibusMinHistoryDays: 20,
      }),
    );
    expect(await screen.findByText("A beállítások mentve.")).toBeTruthy();
  });

  it("without the settings right the page says so and loads nothing", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(WebshopPriceRulesPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a webshop árszabályaihoz"),
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
});
