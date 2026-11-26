import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopShippingSettings } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopShippingSettingsPage } from "./webshop-shipping-settings-page";

/*
  A SZÁLLÍTÁSI DÍJAK ÉS FIZETÉSI MÓDOK LAPJA (kártya e0e2378b). MI PIROSÍT: egy hiányzó vagy hibás díj az API-ig jut; a díjak
  nem a beírt számokkal mennek; a webshop alapértéke vagy a hiányzó érték nem látszik; egy lehetetlen pár (utánvét
  személyes átvételnél) felkínálható; a sorrend-változtatás vagy az eltávolítás nem abban a sorrendben megy, ahogy látszik;
  egy üres lista az API-ig jut; a beállítások joga nélkül a lap működik.
*/
const api = vi.hoisted(() => ({
  get: vi.fn(),
  saveFees: vi.fn(),
  savePayments: vi.fn(),
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
vi.mock("@/lib/api/webshop-shipping-settings", () => ({
  webshopShippingSettingsApi: api,
}));

const settings = (
  over: Partial<WebshopShippingSettings> = {},
): WebshopShippingSettings => ({
  fees: {
    glsNormal: 3500,
    glsHeavy: null,
    foxpost: 1150,
    freeThresholdGls: 50000,
    freeThresholdFoxpost: 30000,
    cashOnDeliveryFee: 450,
  },
  defaultFees: ["cashOnDeliveryFee"],
  unknownPayments: [],
  matrix: {
    PICKUP: ["ONLINE_CARD", "PAY_AT_STORE", "BANK_TRANSFER"],
    GLS_NORMAL: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
    GLS_HEAVY: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
    FOXPOST: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
  },
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  api.get.mockReset().mockResolvedValue(settings());
  api.saveFees.mockReset();
  api.savePayments.mockReset();
});

describe("WebshopShippingSettingsPage", () => {
  // Picasso 3.25 (acrobot 62633): the unit stands beside every field, not only in the card title
  it("every fee and threshold field has its forint unit beside it", async () => {
    render(createElement(WebshopShippingSettingsPage));
    const field = await screen.findByLabelText("Foxpost díja");
    expect(field.closest("label")!.textContent).toContain("Ft");
    expect(screen.getAllByText("Ft")).toHaveLength(6);
  });

  it("shows the six values, the unset and the default one marked", async () => {
    render(createElement(WebshopShippingSettingsPage));
    expect(
      ((await screen.findByLabelText("Foxpost díja")) as HTMLInputElement)
        .value,
    ).toBe("1150");
    expect(
      (screen.getByLabelText("GLS nehézáru díja") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("A webshopban nincs beállítva.")).toBeTruthy();
    expect(
      screen.getByText("A webshop alapértéke; mentéskor rögzül."),
    ).toBeTruthy();
  });

  it("a missing fee stops at the form; the typed fees go as numbers", async () => {
    api.saveFees.mockImplementation(async (_t, fees) =>
      settings({ fees, defaultFees: [] }),
    );
    render(createElement(WebshopShippingSettingsPage));
    await screen.findByLabelText("Foxpost díja");
    fireEvent.click(screen.getByRole("button", { name: "Díjak mentése" }));
    expect(
      await screen.findByText("Egész forint 0 és 1 000 000 között."),
    ).toBeTruthy();
    expect(api.saveFees).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("GLS nehézáru díja"), {
      target: { value: "4500" },
    });
    fireEvent.change(screen.getByLabelText("Foxpost díja"), {
      target: { value: "1290" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Díjak mentése" }));
    await waitFor(() =>
      expect(api.saveFees).toHaveBeenCalledWith("token", {
        glsNormal: 3500,
        glsHeavy: 4500,
        foxpost: 1290,
        freeThresholdGls: 50000,
        freeThresholdFoxpost: 30000,
        cashOnDeliveryFee: 450,
      }),
    );
    expect(await screen.findByText("A díjak mentve.")).toBeTruthy();
  });

  it("an impossible payment is not offered: no cash on delivery at pickup, no paying in the shop with a courier", async () => {
    render(createElement(WebshopShippingSettingsPage));
    await screen.findByLabelText("Foxpost díja");
    expect(
      screen.queryByRole("button", {
        name: "Személyes átvétel az üzletben: Utánvét hozzáadása",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Foxpost csomagautomata: Fizetés az üzletben (készpénz vagy kártya) hozzáadása",
      }),
    ).toBeNull();
  });

  // Picasso 3.25: the order buttons said Fel / Le / Eltávolítás in words (arrows everywhere else); the names for the screen reader stay
  it("the order buttons are arrows and a cross, each still named for the screen reader", async () => {
    render(createElement(WebshopShippingSettingsPage));
    await screen.findByLabelText("Foxpost díja");
    const up = screen.getByRole("button", {
      name: "Foxpost csomagautomata: Utánvét feljebb",
    });
    const down = screen.getByRole("button", {
      name: "Foxpost csomagautomata: Utánvét lejjebb",
    });
    const remove = screen.getByRole("button", {
      name: "Foxpost csomagautomata: Utánvét eltávolítása",
    });
    expect(up.textContent).toBe("↑");
    expect(down.textContent).toBe("↓");
    expect(remove.textContent).toBe("×");
  });

  it("moving, removing and adding go to the API in the order shown", async () => {
    api.savePayments.mockImplementation(async (_t, matrix) =>
      settings({ matrix }),
    );
    render(createElement(WebshopShippingSettingsPage));
    await screen.findByLabelText("Foxpost díja");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Foxpost csomagautomata: Utánvét feljebb",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "GLS nehézáru: Utánvét eltávolítása",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "GLS nehézáru: Utánvét hozzáadása",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fizetési módok mentése" }),
    );
    await waitFor(() =>
      expect(api.savePayments).toHaveBeenCalledWith("token", {
        PICKUP: ["ONLINE_CARD", "PAY_AT_STORE", "BANK_TRANSFER"],
        GLS_NORMAL: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
        GLS_HEAVY: ["ONLINE_CARD", "BANK_TRANSFER", "COD"],
        FOXPOST: ["COD", "ONLINE_CARD", "BANK_TRANSFER"],
      }),
    );
    expect(await screen.findByText("A fizetési módok mentve.")).toBeTruthy();
  });

  it("an emptied list stops at the form", async () => {
    render(createElement(WebshopShippingSettingsPage));
    await screen.findByLabelText("Foxpost díja");
    for (const label of [
      "Online bankkártya",
      "Fizetés az üzletben (készpénz vagy kártya)",
      "Előre utalás",
    ])
      fireEvent.click(
        screen.getByRole("button", {
          name: `Személyes átvétel az üzletben: ${label} eltávolítása`,
        }),
      );
    fireEvent.click(
      screen.getByRole("button", { name: "Fizetési módok mentése" }),
    );
    expect(
      await screen.findByText(/Legalább egy fizetési mód kell/),
    ).toBeTruthy();
    expect(api.savePayments).not.toHaveBeenCalled();
  });

  it("a payment method the OS does not know is named, and the payments cannot be saved", async () => {
    api.get.mockResolvedValue(settings({ unknownPayments: ["CRYPTO"] }));
    render(createElement(WebshopShippingSettingsPage));
    expect(await screen.findByText(/CRYPTO/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Fizetési módok mentése",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("without the settings permission there is nothing to read or save", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(WebshopShippingSettingsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a szállítási beállításokhoz"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Díjak mentése" })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});
