import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const api = vi.hoisted(() => ({
  list: vi.fn(async (_token: string, _query: URLSearchParams) => ({
    items: [],
  })),
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: api }));

import { CustomerPicker, type CustomerSelection } from "./customer-picker";

/**
 * AZ AKVÁRIUMHOZ FELVITT ÚJ ÜGYFÉL: CSAK A NÉV KÖTELEZŐ (Luca, task
 * os-ugyfel-akvarium-hianyos). MI PIROSÍT: ha az űrlap nem mondja ki, hogy
 * csak a név kötelező; ha az e-mail, a telefon vagy a cím mezője kötelezővé
 * válik (`required`); ha a név beírása elveszíti a többit vagy a cím-sort.
 */
afterEach(cleanup);
beforeEach(() => api.list.mockClear());

const NEW: CustomerSelection = {
  newCustomer: {
    type: "PERSON",
    displayName: "",
    email: "",
    phone: "",
    addresses: [{ type: "OTHER", postalCode: "", city: "", line1: "" }],
  },
};

describe("az akváriumhoz felvitt új ügyfél űrlapja", () => {
  it("kimondja, hogy csak a név kötelező, és a többi mező nem kötelező", () => {
    render(<CustomerPicker token="t" selection={NEW} onChange={vi.fn()} />);
    expect(screen.getByTestId("uj-ugyfel-suggo").textContent).toContain(
      "Csak a név kötelező",
    );
    for (const mezo of [
      "Telefonszám",
      "E-mail cím",
      "Irányítószám",
      "Város",
      "Cím",
    ])
      expect(
        (screen.getByLabelText(mezo) as HTMLInputElement).required,
        mezo,
      ).toBe(false);
  });

  it("a név beírása megtartja a többi (üres) mezőt, a cím-sort is", () => {
    const onChange = vi.fn();
    render(<CustomerPicker token="t" selection={NEW} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Kovács" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const kuldott = onChange.mock.calls[0]![0] as CustomerSelection;
    expect(kuldott.newCustomer?.displayName).toBe("Kovács");
    expect(kuldott.newCustomer?.addresses).toEqual([
      { type: "OTHER", postalCode: "", city: "", line1: "" },
    ]);
  });

  it("irányítószám nélkül is beírható a város és az utca", () => {
    const onChange = vi.fn();
    render(<CustomerPicker token="t" selection={NEW} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Város"), {
      target: { value: "Győr" },
    });
    const kuldott = onChange.mock.calls[0]![0] as CustomerSelection;
    expect(kuldott.newCustomer?.addresses?.[0]).toMatchObject({
      postalCode: "",
      city: "Győr",
    });
  });
});

/**
 * A MEGLÉVŐ ÜGYFÉL KERESÉSE AZ EGYESÍTETT PARTNERT IS KÍNÁLJA (40332480). MI PIROSÍT: ha a keresés kérése nem viszi a
 * `includePartnerMirrors` jelzőt (a vevő-lista alapból a partner-kötést viselő sort kihagyja, és az egyesített
 * partner, például egy állatkert, nem lenne kiválasztható); ha a jelző értéke nem `true`.
 */
describe("a meglévő ügyfél keresése az akvárium-lapon", () => {
  it("a partner-kötést viselő sort is kéri a vevő-listától", async () => {
    vi.useFakeTimers();
    try {
      render(<CustomerPicker token="t" selection={{}} onChange={vi.fn()} />);
      fireEvent.change(
        screen.getByPlaceholderText("Név, telefonszám, e-mail"),
        {
          target: { value: "Fővárosi" },
        },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(api.list).toHaveBeenCalledTimes(1);
      const query = api.list.mock.calls[0]![1];
      expect(query.get("search")).toBe("Fővárosi");
      expect(query.get("includePartnerMirrors")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });
});
