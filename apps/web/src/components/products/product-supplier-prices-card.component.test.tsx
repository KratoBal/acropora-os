import { render, screen, waitFor } from "@testing-library/react";
import type { SupplierPriceRow, VariantSupplierPrices } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  KNOWN_SELLING_REASONS,
  ProductSupplierPricesCard,
  rankPrices,
  SupplierPricesTable,
  sellingReasonText,
} from "./product-supplier-prices-card";

const api = vi.hoisted(() => ({ variantPrices: vi.fn() }));
vi.mock("@/lib/api/price-lists", () => ({ priceListsApi: api }));

/**
 * A VÁLTOZAT BESZERZÉSI ÁRAI (task beszallitoi-arlistak-4). Kitalált számok.
 * MI PIROSÍT: ha a legolcsóbb jelzés nem a legolcsóbb forintos sorra kerül; ha az
 * automatikus (nem jóváhagyott) kötés nem látszik; ha a hiányzó árfolyam vagy
 * eladási ár nullának látszik, nem megnevezett oknak; ha a hibát lenyeli a kártya.
 */
const row = (overrides: Partial<SupplierPriceRow> = {}): SupplierPriceRow => ({
  supplierId: "s-1",
  supplierName: "Kitalált Nagyker Kft.",
  supplierSku: "P-100",
  listedName: "Kitalált só 20 kg",
  unitPrice: "40.00",
  currency: "EUR",
  listRetailPrice: null,
  listDate: "2026-10-20",
  listAgeDays: 3,
  matchStatus: "APPROVED",
  matchMethod: "EAN",
  fxRate: "400",
  fxDate: "2026-10-22",
  purchaseHuf: "16000.00",
  profitHuf: "4000.00",
  profitPercent: "20.00",
  ...overrides,
});

const prices = (
  rows: SupplierPriceRow[],
  overrides: Partial<VariantSupplierPrices> = {},
): VariantSupplierPrices => ({
  variantId: "v-1",
  sellingNetHuf: "20000.00",
  sellingReason: null,
  rows,
  ...overrides,
});

describe("a változat beszállítói beszerzési árai", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the unit price, the forint price with its rate and day, the profit in forints and percent", () => {
    render(<SupplierPricesTable prices={prices([row()])} />);
    expect(screen.getByText("Nettó eladási ár: 20 000 Ft.")).toBeTruthy();
    expect(screen.getByText("40 EUR")).toBeTruthy();
    expect(screen.getByText("16 000 Ft")).toBeTruthy();
    expect(screen.getByText(/400 Ft\/EUR, MNB 2026\. 10\. 22\./)).toBeTruthy();
    expect(screen.getByText("4000 Ft")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  const priced = (unitPrice: string, id: string, currency = "EUR") =>
    row({
      supplierId: id,
      supplierName: `Beszállító ${id}`,
      supplierSku: `SKU-${id}`,
      unitPrice,
      currency,
    });
  const rankOfRow = (supplier: string) =>
    screen
      .getByText(`Beszállító ${supplier}`)
      .closest("tr")!
      .querySelector("[data-rank]")!
      .getAttribute("data-rank");

  it("marks the cheapest green and the dearest red, in words too, and leaves the middle one alone", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          priced("12.00", "mid"),
          priced("10.00", "low"),
          priced("15.00", "high"),
        ])}
      />,
    );
    expect([rankOfRow("low"), rankOfRow("mid"), rankOfRow("high")]).toEqual([
      "cheapest",
      "none",
      "dearest",
    ]);
    expect(screen.getAllByText("legolcsóbb")).toHaveLength(1);
    expect(screen.getAllByText("legdrágább")).toHaveLength(1);
    const lowTr = screen.getByText("Beszállító low").closest("tr")!;
    expect(lowTr.querySelector("[data-rank]")!.className).toContain(
      "text-pilot-green-700",
    );
    expect(
      screen
        .getByText("Beszállító high")
        .closest("tr")!
        .querySelector("[data-rank]")!.className,
    ).toContain("text-pilot-red-700");
    expect(
      screen
        .getByText("Beszállító mid")
        .closest("tr")!
        .querySelector("[data-rank]")!.className,
    ).toBe("");
  });

  it("makes two different prices one green and one red", () => {
    render(
      <SupplierPricesTable
        prices={prices([priced("20.00", "a"), priced("10.00", "b")])}
      />,
    );
    expect([rankOfRow("a"), rankOfRow("b")]).toEqual(["dearest", "cheapest"]);
  });

  it("makes equal prices both green, and no red, as the cheapest", () => {
    render(
      <SupplierPricesTable
        prices={prices([priced("10.00", "a"), priced("10", "b")])}
      />,
    );
    expect([rankOfRow("a"), rankOfRow("b")]).toEqual(["cheapest", "cheapest"]);
    expect(screen.queryByText("legdrágább")).toBeNull();
  });

  it("keeps every row at the lowest price green and every row at the highest red when three or more differ", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          priced("10", "a"),
          priced("10", "b"),
          priced("12", "c"),
          priced("14", "d"),
          priced("14", "e"),
        ])}
      />,
    );
    expect(["a", "b", "c", "d", "e"].map(rankOfRow)).toEqual([
      "cheapest",
      "cheapest",
      "none",
      "dearest",
      "dearest",
    ]);
  });

  it("compares numbers, not texts: 9.50 is cheaper than 10.00", () => {
    expect(
      rankPrices([priced("10.00", "a"), priced("9.50", "b")]).ranks,
    ).toEqual(["dearest", "cheapest"]);
  });

  it("does not colour a single price", () => {
    render(<SupplierPricesTable prices={prices([priced("10.00", "a")])} />);
    expect(rankOfRow("a")).toBe("none");
    expect(screen.queryByText("legolcsóbb")).toBeNull();
  });

  it("does not colour prices in different currencies, and says why", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          priced("10.00", "a", "EUR"),
          priced("5.00", "b", "USD"),
        ])}
      />,
    );
    expect([rankOfRow("a"), rankOfRow("b")]).toEqual(["none", "none"]);
    expect(screen.queryByText("legolcsóbb")).toBeNull();
    expect(screen.queryByText("legdrágább")).toBeNull();
    expect(
      screen.getByText(
        /Az árak eltérő pénznemben vannak \(EUR, USD\), ezért nem hasonlítjuk össze és nem színezzük őket\./,
      ),
    ).toBeTruthy();
  });

  it("shows a missing exchange rate as a words, not a zero", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          row({
            currency: "USD",
            purchaseHuf: null,
            profitHuf: null,
            profitPercent: null,
            fxRate: null,
            fxDate: null,
          }),
        ])}
      />,
    );
    expect(screen.getByText("nincs árfolyam")).toBeTruthy();
  });

  it("says when a match is only automatic: the system bound it, nobody approved it", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          row({ matchStatus: "AUTO" }),
          row({
            supplierId: "s-2",
            supplierSku: "P-2",
            matchStatus: "APPROVED",
          }),
        ])}
      />,
    );
    expect(screen.getAllByText("Automatikus, nincs jóváhagyva")).toHaveLength(
      1,
    );
    expect(screen.getAllByText("Jóváhagyva")).toHaveLength(1);
  });

  it("names the reason when there is no selling price, and shows no profit", () => {
    render(
      <SupplierPricesTable
        prices={prices([row({ profitHuf: null, profitPercent: null })], {
          sellingNetHuf: null,
          sellingReason: "vat-rate-missing",
        })}
      />,
    );
    expect(
      screen.getByText(
        "Nettó eladási ár: nincs (nincs áfakulcs a változaton), a haszon nem számítható.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("0 Ft")).toBeNull();
  });

  it("has Hungarian text for every reason code the server can give, never the raw code", () => {
    // the codes of resolvePriceSource (PriceSourceRefusal) and listPriceFromDecision
    expect([...KNOWN_SELLING_REASONS].sort()).toEqual([
      "authority-unknown",
      "mirror-price-missing",
      "mirror-row-missing",
      "own-price-missing",
      "price-missing",
      "vat-rate-missing",
    ]);
    for (const code of KNOWN_SELLING_REASONS)
      expect(sellingReasonText(code)).not.toBe(code);
    expect(sellingReasonText("something-new")).toBe("something-new");
  });

  it("names a non-forint selling currency from the reason code", () => {
    render(
      <SupplierPricesTable
        prices={prices([row()], {
          sellingNetHuf: null,
          sellingReason: "currency-EUR",
        })}
      />,
    );
    expect(
      screen.getByText(/az eladási ár pénzneme nem forint \(EUR\)/),
    ).toBeTruthy();
  });

  it("says plainly when the variant has no matched list row", async () => {
    api.variantPrices.mockResolvedValue(prices([]));
    render(<ProductSupplierPricesCard token="t" variantId="v-1" />);
    expect(
      await screen.findByText(
        "Ehhez a változathoz nincs párosított beszállítói árlista-sor.",
      ),
    ).toBeTruthy();
  });

  it("shows the server's error instead of an empty table", async () => {
    api.variantPrices.mockRejectedValue(new Error("Nincs jogosultság."));
    render(<ProductSupplierPricesCard token="t" variantId="v-1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Nincs jogosultság.")).toBeTruthy();
  });
});
