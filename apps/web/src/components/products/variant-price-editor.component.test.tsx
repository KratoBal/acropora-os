import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizePriceInput,
  VariantPriceEditor,
} from "./variant-price-editor";

const api = vi.hoisted(() => ({ setVariantPrice: vi.fn() }));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

afterEach(() => cleanup());
beforeEach(() => {
  api.setVariantPrice.mockReset();
});

/*
  A SAJÁT ÁR SZERKESZTŐJE (T4.1-D3, 2. szelet). MI PIROSÍT: ha a magyar alakú bevitel (szóköz, vessző) nem pont
  tizedesjelű szövegként megy a szerverre; ha egy nulla, negatív vagy három tizedesjegyű ár elmenne; ha jog nélkül is
  van szerkesztő gomb; ha a mentés után nem kér újratöltést.
*/
function renderEditor({
  price = "9990.0000" as string | null,
  canManage = true,
} = {}) {
  const onSaved = vi.fn();
  render(
    <VariantPriceEditor
      productId="product-1"
      variantId="variant-1"
      sellingGrossPrice={price}
      sellingPriceCurrency={price ? "HUF" : null}
      canManage={canManage}
      token="token-1"
      onSaved={onSaved}
    />,
  );
  return onSaved;
}

describe("VariantPriceEditor", () => {
  it("normalizes the Hungarian input and refuses what the server would refuse", () => {
    expect(normalizePriceInput("12 990")).toBe("12990");
    expect(normalizePriceInput("12 990,5")).toBe("12990.5");
    expect(normalizePriceInput("12990.50")).toBe("12990.50");
    expect(normalizePriceInput("0")).toBeNull();
    expect(normalizePriceInput("0,00")).toBeNull();
    expect(normalizePriceInput("-5")).toBeNull();
    expect(normalizePriceInput("12,345")).toBeNull();
    expect(normalizePriceInput("abc")).toBeNull();
  });

  it("saves the normalized price and asks for a reload", async () => {
    api.setVariantPrice.mockResolvedValue({ id: "product-1" });
    const onSaved = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Ár módosítása" }));
    fireEvent.change(screen.getByLabelText("Saját bruttó eladási ár"), {
      target: { value: "12 990,50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ár mentése" }));

    await waitFor(() =>
      expect(api.setVariantPrice).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        "variant-1",
        "12990.50",
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("does not send an invalid price", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Ár módosítása" }));
    fireEvent.change(screen.getByLabelText("Saját bruttó eladási ár"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ár mentése" }));

    expect(api.setVariantPrice).not.toHaveBeenCalled();
    expect(screen.getByText("Az ár nem mentődött")).toBeTruthy();
  });

  it("shows the price without an edit button to a viewer", () => {
    renderEditor({ canManage: false });
    expect(screen.queryByRole("button", { name: "Ár módosítása" })).toBeNull();
  });

  it("says when there is no own price yet", () => {
    renderEditor({ price: null });
    expect(screen.getByText("Nincs saját ár")).toBeTruthy();
  });
});
