import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteItemDrawer } from "./quote-item-drawer";

/*
  BOM -> ÖNÁLLÓ EGY LÉPÉSBEN (Luca, t-20261116-bom-tetel-visszavaltas). A váltás eddig elakadt, ha a tételnek BOM-sora
  volt, és a hibaüzenet nem mondta meg, hol törölhető: a szerkesztő jobb oldali kártyáján a BOM-sorok törlés gomb
  nélkül látszanak (stage-en mérve a szerver törlése működött). MI PIROSÍT: a BOM-sorokkal bíró tétel önállóra váltása
  megerősítés nélkül megy, vagy a megerősítés után nem kéri a sorok törlését; egy BOM-sor nélküli váltás vagy egy
  BOM-on maradó mentés megerősítést kér, vagy törlést kér.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const api = vi.hoisted(() => ({ updateItem: vi.fn(), addItem: vi.fn() }));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: api }));

const item = (source: "BOM" | "STANDALONE" | "PRODUCT") =>
  ({
    id: "item-1",
    source,
    variantId: null,
    name: "Szűrő",
    description: null,
    quantity: "1",
    unit: "db",
    unitNetPrice: "1000",
    vatRatePercent: "27",
    isOptional: false,
  }) as never;

function open(source: "BOM" | "STANDALONE" | "PRODUCT", bomCount: number) {
  render(
    <QuoteItemDrawer
      open
      onClose={() => {}}
      token="t"
      quoteId="q-1"
      versionId="v-1"
      currency="HUF"
      blockId={null}
      item={item(source)}
      costing={null}
      bomCount={bomCount}
      onSaved={() => {}}
    />,
  );
}

beforeEach(() => {
  api.updateItem.mockReset();
  api.updateItem.mockResolvedValue({ id: "q-1" });
});

describe("tétel: BOM-ból önállóra váltás", () => {
  it("BOM-sorok mellett megerősítést kér, és csak utána menti a sorok törlésével", async () => {
    open("BOM", 2);
    fireEvent.click(
      screen.getByRole("radio", { name: /Önálló ajánlati tétel/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    expect(await screen.findByText(/a tétel 2 BOM-sora/)).toBeTruthy();
    expect(api.updateItem).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Váltás és a BOM-sorok törlése" }),
    );
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).toMatchObject({
      source: "STANDALONE",
      dropBomItems: true,
    });
  });

  it("a megerősítés elvetése nem ment semmit", async () => {
    open("BOM", 1);
    fireEvent.click(
      screen.getByRole("radio", { name: /Önálló ajánlati tétel/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await screen.findByText(/a tétel 1 BOM-sora/);
    // the dialog's own cancel ("Mégsem"), not the drawer footer's
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it("BOM-sor nélkül, vagy BOM-on maradva nincs megerősítés és nincs törlés-kérés", async () => {
    open("BOM", 0);
    fireEvent.click(
      screen.getByRole("radio", { name: /Önálló ajánlati tétel/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).not.toHaveProperty("dropBomItems");
  });

  it("BOM-on maradó mentés a BOM-sorok mellett sem kérdez", async () => {
    open("BOM", 3);
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).toMatchObject({ source: "BOM" });
    expect(api.updateItem.mock.calls[0]![4]).not.toHaveProperty("dropBomItems");
  });
});
