import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WebshopOrderTaxCheck } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderTaxCheck } from "./webshop-order-tax-check";

const api = vi.hoisted(() => ({ taxCheck: vi.fn() }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "t" } }),
}));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));

const answer = (
  state: WebshopOrderTaxCheck["state"],
  extra: Partial<WebshopOrderTaxCheck> = {},
): WebshopOrderTaxCheck => ({
  state,
  taxNumber: "12345678-2-41",
  navName: null,
  nameMatches: null,
  ...extra,
});

const view = () =>
  render(
    createElement(OrderTaxCheck, {
      orderId: "order_38",
      taxNumber: "12345678-2-41",
      company: "Minta Kft.",
    }),
  );

const press = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Ellenőrzés a NAV-nál" }));
  return screen.findByTestId("adoszam-eredmeny");
};

beforeEach(() => api.taxCheck.mockReset());

/**
 * A RENDELÉS ADÓSZÁMA A NAV-NÁL (kártya c977aed2, P2). MI PIROSÍT: ha adószám nélkül gomb jelenik meg; ha az ellenőrzés az oldal
 * megnyitásakor fut (kérésre kell: minden hívás egy NAV-kérés); ha a NAV kiesése hibának látszik (nem az); ha a név-eltérés nem
 * jelenik meg, vagy tiltásnak látszik; ha a NAV "nincs ilyen" válasza nem mondja ki, hogy a szerver nem állít ki számlát.
 */
describe("OrderTaxCheck", () => {
  it("without a tax number there is nothing to check", () => {
    const { container } = render(
      createElement(OrderTaxCheck, {
        orderId: "o",
        taxNumber: null,
        company: null,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the number, and does not ask the NAV until asked", () => {
    view();
    expect(screen.getByTestId("adoszam-ellenorzes")).toHaveTextContent(
      "12345678-2-41",
    );
    expect(api.taxCheck).not.toHaveBeenCalled();
  });

  it("asks with the order's id and says what the NAV knows", async () => {
    api.taxCheck.mockResolvedValue(
      answer("VALID", {
        navName: "MINTA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
        nameMatches: true,
      }),
    );
    view();
    const result = await press();
    expect(api.taxCheck).toHaveBeenCalledWith("t", "order_38");
    expect(result).toHaveTextContent(
      "A NAV ismeri: MINTA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG.",
    );
  });

  it("a name that differs is a warning with both names, not a refusal", async () => {
    api.taxCheck.mockResolvedValue(
      answer("VALID", { navName: "Teljesen Más Zrt.", nameMatches: false }),
    );
    view();
    const result = await press();
    expect(result).toHaveTextContent("más néven: Teljesen Más Zrt.");
    expect(result).toHaveTextContent("Minta Kft.");
    expect(result.className).toContain("amber");
  });

  it("'no such number' and a malformed one say that no invoice goes out on it", async () => {
    api.taxCheck.mockResolvedValue(answer("INVALID"));
    const first = view();
    expect(await press()).toHaveTextContent(
      "A NAV szerint nincs ilyen adószám",
    );
    expect(screen.getByTestId("adoszam-eredmeny")).toHaveTextContent(
      "nem állít ki számlát",
    );
    first.unmount();
    api.taxCheck.mockResolvedValue(answer("MALFORMED"));
    view();
    expect(await press()).toHaveTextContent("alakja nem érvényes");
  });

  it("a NAV that did not answer says it is NOT a verdict on the number", async () => {
    api.taxCheck.mockResolvedValue(answer("UNAVAILABLE"));
    view();
    const result = await press();
    expect(result).toHaveTextContent("NEM azt jelenti, hogy az adószám rossz");
    expect(result.className).toContain("amber");
  });

  it("a Community number is not checkable at the NAV, and says so", async () => {
    api.taxCheck.mockResolvedValue(
      answer("NONE", { taxNumber: "DE123456789" }),
    );
    view();
    expect(await press()).toHaveTextContent("a NAV-nál nem ellenőrizhető");
  });

  it("a failed request shows its message and the button comes back", async () => {
    // the rejection happens AFTER the component attached its handlers (a mock that rejects at call time is reported as unhandled)
    // (and a plain function, not a spy: the spy's own result tracking reports the rejection as unhandled)
    let fail: (error: Error) => void = () => undefined;
    const spy = api.taxCheck;
    api.taxCheck = (() =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })) as unknown as typeof spy;
    view();
    fireEvent.click(
      screen.getByRole("button", { name: "Ellenőrzés a NAV-nál" }),
    );
    fail(new Error("A webshop nem érhető el."));
    expect(
      await screen.findByText("A webshop nem érhető el."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Ellenőrzés a NAV-nál" }),
      ).toBeEnabled(),
    );
    api.taxCheck = spy;
  });
});
