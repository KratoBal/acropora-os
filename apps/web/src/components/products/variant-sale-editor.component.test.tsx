import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { budapestDayOf, budapestDayStartIso, nextDay } from "@/lib/format/date";

import {
  saleRequestOf,
  saleStateOf,
  VariantSaleEditor,
} from "./variant-sale-editor";

const api = vi.hoisted(() => ({
  setVariantSale: vi.fn(),
  clearVariantSale: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

afterEach(() => cleanup());
beforeEach(() => {
  api.setVariantSale.mockReset();
  api.clearVariantSale.mockReset();
});

/*
  THE OWN SALE EDITOR (T4.1-D3, sale slice 2b). WHAT TURNS THIS RED: a Budapest day sent as a UTC day (the sale
  would start one or two hours late, and the summer and winter offsets differ); the last day sent as the end (the
  half-open window would drop the last day); a sale at or above the regular price leaving the form; an editor
  without the manage right; no reload after a save or a delete; a running sale shown as planned.
*/
const NOW = new Date("2026-11-12T10:00:00.000Z");

function renderEditor({
  sale = null as null | { price: string; startsAt: string; endsAt: string },
  price = "9990.0000" as string | null,
  canManage = true,
} = {}) {
  const onSaved = vi.fn();
  render(
    <VariantSaleEditor
      productId="product-1"
      variantId="variant-1"
      sellingGrossPrice={price}
      sellingPriceCurrency={price ? "HUF" : null}
      sellingSaleGrossPrice={sale?.price ?? null}
      sellingSaleStartsAt={sale?.startsAt ?? null}
      sellingSaleEndsAt={sale?.endsAt ?? null}
      canManage={canManage}
      token="token-1"
      onSaved={onSaved}
      now={() => NOW}
    />,
  );
  return onSaved;
}

describe("Budapest days", () => {
  it("a day's first moment carries that day's own offset, winter and summer", () => {
    expect(budapestDayStartIso("2026-11-10")).toBe("2026-11-09T23:00:00.000Z");
    expect(budapestDayStartIso("2026-07-10")).toBe("2026-07-09T22:00:00.000Z");
    // the clock changes at 03:00 on 2026-10-25: the day itself still began at +02:00
    expect(budapestDayStartIso("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
    expect(budapestDayStartIso("2026-10-26")).toBe("2026-10-25T23:00:00.000Z");
    expect(budapestDayStartIso("nem nap")).toBeNull();
  });

  it("the day of an instant is Budapest's, and the next day crosses month and year", () => {
    expect(budapestDayOf("2026-11-09T23:30:00.000Z")).toBe("2026-11-10");
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("saleRequestOf", () => {
  it("sends the first day's start and the moment AFTER the last day", () => {
    expect(
      saleRequestOf(
        { price: "7 990", firstDay: "2026-11-10", lastDay: "2026-11-16" },
        "9990.0000",
      ),
    ).toEqual({
      grossPrice: "7990",
      startsAt: "2026-11-09T23:00:00.000Z",
      endsAt: "2026-11-16T23:00:00.000Z",
    });
  });

  it("a one-day sale is a whole day", () => {
    expect(
      saleRequestOf(
        { price: "7990", firstDay: "2026-11-10", lastDay: "2026-11-10" },
        "9990",
      ),
    ).toMatchObject({
      startsAt: "2026-11-09T23:00:00.000Z",
      endsAt: "2026-11-10T23:00:00.000Z",
    });
  });

  it("refuses a sale at or above the regular price, a bad price, a missing or reversed day", () => {
    const at = (over: Partial<Parameters<typeof saleRequestOf>[0]>) =>
      saleRequestOf(
        {
          price: "7990",
          firstDay: "2026-11-10",
          lastDay: "2026-11-16",
          ...over,
        },
        "9990.0000",
      );
    expect(at({ price: "9990" })).toBe(
      "Az akciós ár a rendes ár alatt legyen.",
    );
    expect(at({ price: "12000" })).toBe(
      "Az akciós ár a rendes ár alatt legyen.",
    );
    expect(at({ price: "79,90" })).toMatch(/pozitív egész forint/);
    expect(at({ lastDay: "" })).toMatch(/első és utolsó napját/);
    expect(at({ lastDay: "2026-11-09" })).toMatch(
      /nem lehet az első nap előtt/,
    );
  });
});

describe("saleStateOf", () => {
  it("the start instant is running, the end instant is over", () => {
    const s = "2026-11-09T23:00:00.000Z";
    const e = "2026-11-16T23:00:00.000Z";
    expect(saleStateOf(s, e, new Date(s))).toBe("running");
    expect(saleStateOf(s, e, new Date(e))).toBe("ended");
    expect(saleStateOf(s, e, new Date("2026-11-09T22:59:59.000Z"))).toBe(
      "planned",
    );
  });
});

describe("VariantSaleEditor", () => {
  it("shows the running sale with its exact window, and saves a changed one as days", async () => {
    api.setVariantSale.mockResolvedValue({});
    const onSaved = renderEditor({
      sale: {
        price: "7990.0000",
        startsAt: "2026-11-09T23:00:00.000Z",
        endsAt: "2026-11-16T23:00:00.000Z",
      },
    });
    expect(screen.getByTestId("variant-sale-current").textContent).toMatch(
      /2026\. 11\. 10\. 00:00-tól 2026\. 11\. 17\. 00:00-ig \(most fut\)/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Akció módosítása" }));
    // the form is filled from the stored sale: the last day is the day BEFORE the stored end, so the unchanged
    // days go back as the same window (asserted on the request below; the date field shows them in Hungarian)
    fireEvent.change(screen.getByLabelText("Akciós bruttó ár"), {
      target: { value: "6 990" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Akció mentése" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.setVariantSale).toHaveBeenCalledWith(
      "token-1",
      "product-1",
      "variant-1",
      {
        grossPrice: "6990",
        startsAt: "2026-11-09T23:00:00.000Z",
        endsAt: "2026-11-16T23:00:00.000Z",
      },
    );
  });

  it("does not send a sale above the regular price, and says why", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Akció beállítása" }));
    fireEvent.change(screen.getByLabelText("Akciós bruttó ár"), {
      target: { value: "10 990" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Akció mentése" }));
    expect(api.setVariantSale).not.toHaveBeenCalled();
    expect(
      screen.getByText("Az akciós ár a rendes ár alatt legyen."),
    ).toBeTruthy();
  });

  it("shows the server's refusal", async () => {
    api.setVariantSale.mockRejectedValue(
      new Error("Az akció vége már elmúlt."),
    );
    const onSaved = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Akció beállítása" }));
    fireEvent.change(screen.getByLabelText("Akciós bruttó ár"), {
      target: { value: "7990" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Akció mentése" }));
    await screen.findByText("Az akció vége már elmúlt.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("deletes the sale and reloads", async () => {
    api.clearVariantSale.mockResolvedValue({});
    const onSaved = renderEditor({
      sale: {
        price: "7990.0000",
        startsAt: "2026-11-20T23:00:00.000Z",
        endsAt: "2026-11-27T23:00:00.000Z",
      },
    });
    expect(screen.getByTestId("variant-sale-current").textContent).toMatch(
      /még nem kezdődött el/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Akció törlése" }));
    // nothing is deleted before the shared confirmation
    expect(api.clearVariantSale).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Akció törlése" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.clearVariantSale).toHaveBeenCalledWith(
      "token-1",
      "product-1",
      "variant-1",
    );
  });

  it("no buttons without the manage right; no editor without an own price", () => {
    renderEditor({ canManage: false });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    renderEditor({ price: null });
    expect(screen.getByText(/saját eladási ár megadása után/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
