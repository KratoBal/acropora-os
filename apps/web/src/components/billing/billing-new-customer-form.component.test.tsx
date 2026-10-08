import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingNewCustomerForm } from "./billing-new-customer-form";

const api = vi.hoisted(() => ({
  customers: { list: vi.fn(), create: vi.fn(), detail: vi.fn() },
  nav: { lookup: vi.fn() },
  vies: { check: vi.fn() },
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: api.customers }));
vi.mock("@/lib/api/nav-taxpayer", () => ({ navTaxpayerApi: api.nav }));
vi.mock("@/lib/api/vies-vat", () => ({ viesVatApi: api.vies }));

const created = { id: "c-new", customerNumber: "V-9" };

function renderForm(initialSearch: string) {
  const onSaved = vi.fn();
  const onPickExisting = vi.fn();
  render(
    <BillingNewCustomerForm
      token="t"
      initialSearch={initialSearch}
      onSaved={onSaved}
      onPickExisting={onPickExisting}
      onClose={vi.fn()}
    />,
  );
  return { onSaved, onPickExisting };
}

describe("Új vevő a számla Vevő kártyáján (acrobot 28105)", () => {
  beforeEach(() => {
    api.customers.list.mockReset();
    api.customers.create.mockReset();
    api.customers.detail.mockReset();
    api.nav.lookup.mockReset();
    api.vies.check.mockReset();
  });

  it("magyar adószám: a NAV kitölti, a vevő adószámmal és címmel mentődik és kiválasztódik", async () => {
    api.nav.lookup.mockResolvedValue({
      valid: true,
      data: {
        name: "Adapt Kft.",
        taxNumber: "12345678-2-42",
        address: {
          country: "HU",
          postalCode: "1106",
          city: "Budapest",
          line1: "Pesti Gábor utca 1.",
        },
      },
    });
    api.customers.list.mockResolvedValue({ items: [] });
    api.customers.create.mockResolvedValue(created);
    const { onSaved } = renderForm("12345678242");
    // the typed tax number is carried over from the search
    expect((screen.getByLabelText("Adószám") as HTMLInputElement).value).toBe(
      "12345678242",
    );
    fireEvent.click(screen.getByRole("button", { name: "Kitöltés a NAV-ból" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Cégnév") as HTMLInputElement).value).toBe(
        "Adapt Kft.",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(api.customers.create).toHaveBeenCalledWith("t", {
      type: "COMPANY",
      displayName: "Adapt Kft.",
      companyName: "Adapt Kft.",
      taxNumber: "12345678-2-42",
      addresses: [
        {
          type: "BILLING",
          country: "HU",
          postalCode: "1106",
          city: "Budapest",
          line1: "Pesti Gábor utca 1.",
          isDefault: true,
        },
      ],
    });
  });

  it("azonos adószámú vevő létezésekor azt ajánlja fel, és nem vesz fel újat", async () => {
    api.nav.lookup.mockResolvedValue({
      valid: true,
      data: {
        name: "Adapt Kft.",
        taxNumber: "12345678-2-42",
        address: {
          country: "HU",
          postalCode: "1106",
          city: "Budapest",
          line1: "Fő utca 1.",
        },
      },
    });
    const existing = {
      id: "c-old",
      displayName: "Adapt",
      companyName: "Adapt Kft.",
      customerNumber: "V-1",
    };
    // the second only has the digits in its customer number: not the same company
    const lookalike = {
      id: "c-num",
      displayName: "Más Bt.",
      companyName: "Más Bt.",
      customerNumber: "V-12345678",
    };
    api.customers.list.mockResolvedValue({ items: [existing, lookalike] });
    api.customers.detail.mockImplementation(async (_t: string, id: string) =>
      id === "c-old"
        ? { id, taxNumber: "12345678-2-42" }
        : { id, taxNumber: null },
    );
    const { onSaved, onPickExisting } = renderForm("12345678-2-42");
    fireEvent.click(screen.getByRole("button", { name: "Kitöltés a NAV-ból" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Cím") as HTMLInputElement).value).toBe(
        "Fő utca 1.",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    expect(
      await screen.findByText("Ezzel az adószámmal már van vevő:"),
    ).toBeTruthy();
    // the search is by the first eight digits, with the separators gone
    expect(api.customers.list.mock.calls[0]![1].get("search")).toBe("12345678");
    expect(screen.queryByRole("button", { name: /Más Bt\./ })).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: /Adapt Kft\./ }));
    expect(onPickExisting).toHaveBeenCalledWith(existing);
    expect(api.customers.create).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("EU-s cég: a VIES nevet ad, a közösségi adószám a saját mezőjébe kerül, nem a vevő adószámába", async () => {
    api.vies.check.mockResolvedValue({ valid: true, name: "Slovak s.r.o." });
    api.customers.create.mockResolvedValue(created);
    const { onSaved } = renderForm("SK2020123456");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      screen.getByText(/a számlán a közösségi adószám helyén szerepel/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Ellenőrzés a VIES-ben" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Cégnév") as HTMLInputElement).value).toBe(
        "Slovak s.r.o.",
      ),
    );
    fireEvent.change(screen.getByLabelText("Irányítószám"), {
      target: { value: "81101" },
    });
    fireEvent.change(screen.getByLabelText("Város"), {
      target: { value: "Bratislava" },
    });
    fireEvent.change(screen.getByLabelText("Cím"), {
      target: { value: "Hlavná 1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const input = api.customers.create.mock.calls[0]![1];
    expect(
      [input.taxNumber, input.euTaxNumber, input.addresses[0].country],
      "WEB-EU-TAX-SAVED",
    ).toEqual([undefined, "SK2020123456", "SK"]);
    // no duplicate search for an EU number: there is nothing to match yet
    expect(api.customers.list).not.toHaveBeenCalled();
  });

  it("a HU előtagos adószámot előtag nélkül kérdezi a NAV-tól", async () => {
    api.nav.lookup.mockResolvedValue({ valid: false, data: null });
    renderForm("HU12345678-2-42");
    // a HU number is not an EU one here
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kitöltés a NAV-ból" }));
    await waitFor(() =>
      expect(api.nav.lookup).toHaveBeenCalledWith("t", "12345678-2-42"),
    );
  });

  it("EU-s módban országkód nélkül nem menthető", () => {
    renderForm("Valami s.r.o.");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Közösségi adószám"), {
      target: { value: "2020123456" },
    });
    for (const [label, value] of [
      ["Irányítószám", "81101"],
      ["Város", "Bratislava"],
      ["Cím", "Hlavná 1"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    const save = screen.getByRole("button", {
      name: "Vevő mentése és kiválasztása",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/az ország kódjával kezdődik/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Közösségi adószám"), {
      target: { value: "SK2020123456" },
    });
    expect(save.disabled).toBe(false);
  });
});
