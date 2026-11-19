import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopGiftCard } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopGiftCardsPage } from "./webshop-gift-cards-page";

/*
  A WEBSHOP AJÁNDÉKKÁRTYÁINAK LAPJA (kártya 495c0007). MI PIROSÍT: egy hibás összeg az API-ig jut; a kiadás után a kód
  nem látszik, vagy a lista nem frissül; a napló nem a kártyáé; a kikapcsolás nem a kártyát kéri; a beállítások joga
  nélkül a lap működik.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  issue: vi.fn(),
  disable: vi.fn(),
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
vi.mock("@/lib/api/webshop-gift-cards", () => ({ webshopGiftCardsApi: api }));

const card = (over: Partial<WebshopGiftCard> = {}): WebshopGiftCard => ({
  id: "gcard_1",
  codeLast4: "H4BW",
  initialAmount: 10000,
  balance: 4000,
  status: "active",
  expiresAt: null,
  recipientEmail: "vevo@example.test",
  note: null,
  createdAt: "2026-11-19T05:00:00.000Z",
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  api.list
    .mockReset()
    .mockResolvedValue({ giftCards: [card()], truncated: false });
  api.get.mockReset();
  api.issue.mockReset();
  api.disable.mockReset();
});

describe("WebshopGiftCardsPage", () => {
  it("lists the cards by their last four characters and balance", async () => {
    render(createElement(WebshopGiftCardsPage));
    expect(await screen.findByText("…H4BW")).toBeTruthy();
    expect(screen.getByText("4 000 Ft")).toBeTruthy();
  });

  it("a bad amount stops at the form; a good one issues, shows the code once, and lists the card", async () => {
    api.issue.mockResolvedValue({
      giftCard: card({
        id: "gcard_2",
        codeLast4: "9XYZ",
        initialAmount: 15000,
        balance: 15000,
      }),
      code: "7K3M-QX9P-2ZRT-9XYZ",
    });
    render(createElement(WebshopGiftCardsPage));
    await screen.findByText("…H4BW");
    fireEvent.change(screen.getByLabelText("Az ajándékkártya összege"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kártya kiadása" }));
    expect(
      await screen.findByText("Egész forint 1 és 1 000 000 között."),
    ).toBeTruthy();
    expect(api.issue).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Az ajándékkártya összege"), {
      target: { value: "15000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kártya kiadása" }));
    await waitFor(() =>
      expect(api.issue).toHaveBeenCalledWith("token", {
        amount: 15000,
        recipientEmail: null,
        note: null,
      }),
    );
    expect(await screen.findByText("7K3M-QX9P-2ZRT-9XYZ")).toBeTruthy();
    expect(screen.getByText("…9XYZ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kész" }));
    expect(screen.queryByText("7K3M-QX9P-2ZRT-9XYZ")).toBeNull();
  });

  it("the ledger is the card's, and switching off asks for the card", async () => {
    api.get.mockResolvedValue({
      ...card(),
      transactions: [
        {
          id: "t1",
          kind: "issue",
          amount: 10000,
          balanceAfter: 10000,
          reference: null,
          createdAt: "x",
        },
        {
          id: "t2",
          kind: "redeem",
          amount: -6000,
          balanceAfter: 4000,
          reference: "cart_1",
          createdAt: "y",
        },
      ],
    });
    api.disable.mockResolvedValue(card({ status: "disabled" }));
    render(createElement(WebshopGiftCardsPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "…H4BW: napló" }),
    );
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("token", "gcard_1"),
    );
    expect(
      (await screen.findByTestId("gift-card-ledger")).textContent,
    ).toContain("Beváltás");
    fireEvent.click(screen.getByRole("button", { name: "…H4BW: kikapcsolás" }));
    // the dialog asks first: nothing is switched off until it is confirmed
    expect(api.disable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Kikapcsolom" }));
    await waitFor(() =>
      expect(api.disable).toHaveBeenCalledWith("token", "gcard_1"),
    );
    expect(await screen.findByText("Kikapcsolva")).toBeTruthy();
  });

  it("without the settings permission there is neither list nor form", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(WebshopGiftCardsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed az ajándékkártyákhoz"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kártya kiadása" })).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });
});
