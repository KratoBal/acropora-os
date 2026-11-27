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

/*
  KIVÁLTOTT TÉTEL (Luca 2026-11-26, card 2540d9d4): az opcionális tétel űrlapján választható, melyik (nem opcionális) tételt váltja ki. MI PIROSÍT: ha
  a választó nem opcionális tételnél is látszik; ha opcionális tételt vagy magát a tételt kínálja; ha a már egy másik opció által kiváltott tételt NEM kínálja (alternatíva, Luca 2026-11-27: az is kiváltható, az ügyfél egyet választ); ha a
  mentés nem a kiválasztott azonosítót küldi (vagy üresnél nem null-t); ha az opcionális jelölés visszavétele után a kiváltás elküldődik.
*/
const line = (
  id: string,
  name: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  position: 0,
  name,
  description: null,
  quantity: "1",
  unit: "db",
  unitNetPrice: "1000",
  vatRatePercent: "27",
  isOptional: false,
  replacesItemId: null,
  source: "STANDALONE" as const,
  variantId: null,
  variantLabel: null,
  ...over,
});

const LINES = [
  line("a", "A régi szűrő"),
  line("b", "B tartó"),
  line("c", "C már kiváltott"),
  line("o", "O egy opcionális"),
  line("x", "X másik opcionális", { isOptional: true, replacesItemId: "c" }),
  line("item-1", "Szűrő", { isOptional: true }),
];

function openReplacing(over: Record<string, unknown> = {}) {
  render(
    <QuoteItemDrawer
      open
      onClose={() => {}}
      token="t"
      quoteId="q-1"
      versionId="v-1"
      currency="HUF"
      blockId={null}
      item={line("item-1", "Szűrő", over) as never}
      costing={null}
      lines={LINES as never}
      onSaved={() => {}}
    />,
  );
}

describe("tétel: kiváltott tétel", () => {
  it("nem opcionális tételnél nincs választó, opcionálisnál van, és minden kiváltható tételt kínál, a már kiváltottat is", () => {
    openReplacing();
    expect(screen.queryByLabelText("Kiváltott tétel")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Opcionális tétel/ }));
    const select = screen.getByLabelText(
      "Kiváltott tétel",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Nincs (kiegészítés)",
      "A régi szűrő",
      "B tartó",
      // a már egy másik opció (X) által kiváltott tétel is ott áll: alternatívát lehet hozzá felvenni
      "C már kiváltott",
      "O egy opcionális",
    ]);
    expect(select.value).toBe("");
  });

  it("a kiválasztott tétel azonosítóját menti", async () => {
    openReplacing();
    fireEvent.click(screen.getByRole("checkbox", { name: /Opcionális tétel/ }));
    fireEvent.change(screen.getByLabelText("Kiváltott tétel"), {
      target: { value: "b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).toMatchObject({
      isOptional: true,
      replacesItemId: "b",
    });
  });

  it("a Nincs (kiegészítés) választás null-t küld, és a korábbi kiváltást megszünteti", async () => {
    openReplacing({ isOptional: true, replacesItemId: "a" });
    fireEvent.change(screen.getByLabelText("Kiváltott tétel"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).toMatchObject({
      isOptional: true,
      replacesItemId: null,
    });
  });

  it("a már kiváltó tétel a saját kiváltottját előre kijelölve és választhatóan mutatja", () => {
    render(
      <QuoteItemDrawer
        open
        onClose={() => {}}
        token="t"
        quoteId="q-1"
        versionId="v-1"
        currency="HUF"
        blockId={null}
        item={
          line("x", "X másik opcionális", {
            isOptional: true,
            replacesItemId: "c",
          }) as never
        }
        costing={null}
        lines={LINES as never}
        onSaved={() => {}}
      />,
    );
    const select = screen.getByLabelText(
      "Kiváltott tétel",
    ) as HTMLSelectElement;
    expect(select.value).toBe("c");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain(
      "C már kiváltott",
    );
  });

  it("az opcionális jelölés ki- és újrakapcsolása után a választó üres, nem a régi kiváltást mutatja", () => {
    openReplacing({ isOptional: true, replacesItemId: "a" });
    const box = screen.getByRole("checkbox", { name: /Opcionális tétel/ });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(
      (screen.getByLabelText("Kiváltott tétel") as HTMLSelectElement).value,
    ).toBe("");
  });

  it("az opcionális jelölés visszavétele után a kiváltás nem megy el", async () => {
    openReplacing({ isOptional: true, replacesItemId: "a" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Opcionális tétel/ }));
    expect(screen.queryByLabelText("Kiváltott tétel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0]![4]).toMatchObject({
      isOptional: false,
      replacesItemId: null,
    });
  });
});
