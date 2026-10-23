import { render, screen, waitFor } from "@testing-library/react";
import type { SupplierPriceRow, VariantSupplierPrices } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductSupplierPricesCard,
  SupplierPricesTable,
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

  it("marks only the first forint-priced row as the cheapest", () => {
    render(
      <SupplierPricesTable
        prices={prices([
          row({
            supplierId: "s-2",
            supplierName: "Olcsó Kft.",
            purchaseHuf: "9000.00",
          }),
          row({ supplierId: "s-1" }),
          row({
            supplierId: "s-3",
            supplierName: "Árfolyam nélküli Kft.",
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
    expect(screen.getAllByText("Legolcsóbb")).toHaveLength(1);
    const badge = screen.getByText("Legolcsóbb");
    expect(badge.closest("span.flex")?.textContent).toContain("Olcsó Kft.");
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
