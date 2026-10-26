import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const api = vi.hoisted(() => ({ list: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/lib/api/customers", () => ({ customersApi: api }));

import { CustomerPicker, type CustomerSelection } from "./customer-picker";

/**
 * AZ AKVÁRIUMHOZ FELVITT ÚJ ÜGYFÉL: CSAK A NÉV KÖTELEZŐ (Luca, task
 * os-ugyfel-akvarium-hianyos). MI PIROSÍT: ha az űrlap nem mondja ki, hogy
 * csak a név kötelező; ha az e-mail, a telefon vagy a cím mezője kötelezővé
 * válik (`required`); ha a név beírása elveszíti a többit vagy a cím-sort.
 */
afterEach(cleanup);

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
