import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingNewCustomerForm } from "./billing-new-customer-form";

const api = vi.hoisted(() => ({
  customers: {
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
  },
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
    api.customers.update.mockReset();
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
    // MI PIROSIT: ha a keresés nem kéri a partner-kötést viselő sorokat, egy már a törzsben lévő partner (az egyesítés
    // után egy sor a partnerrel) új cégnek látszana, és második sor jönne létre ugyanazzal az adószámmal
    expect(
      api.customers.list.mock.calls[0]![1].get("includePartnerMirrors"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: /Más Bt\./ })).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: /Adapt Kft\./ }));
    expect(onPickExisting).toHaveBeenCalledWith(existing);
    expect(api.customers.create).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // 40332480 (barracuda #2228): a tukor vevo-soraibol hianyozhat az adoszam, a reszlet partner-javaslata (partnerTaxHint)
  // hordozza. MI PIROSIT: ha a duplikacio-szuro csak a sor sajat adoszamat nezi, a megtalalt tukor kiesne, es a ceg
  // ujnak latszana
  it("a partner's customer row without a tax number of its own is the duplicate through the partner hint", async () => {
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
    const mirror = {
      id: "c-mirror",
      displayName: "Adapt",
      companyName: "Adapt Kft.",
      customerNumber: "PARTNER-1",
      partnerMirror: true,
    };
    api.customers.list.mockResolvedValue({ items: [mirror] });
    api.customers.detail.mockResolvedValue({
      id: "c-mirror",
      taxNumber: null,
      partnerTaxHint: { partnerName: "Adapt Kft.", taxNumber: "12345678-2-42" },
    });
    renderForm("12345678-2-42");
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
    expect(screen.getByRole("button", { name: /Adapt Kft\./ })).toBeTruthy();
    expect(api.customers.create).not.toHaveBeenCalled();
  });

  it("EU-s cég: a VIES nevet ad, a közösségi adószám a saját mezőjébe kerül, nem a vevő adószámába", async () => {
    api.vies.check.mockResolvedValue({ valid: true, name: "Slovak s.r.o." });
    api.customers.create.mockResolvedValue(created);
    const { onSaved } = renderForm("SK2020123456");
    expect(
      (screen.getByLabelText("EU-s cég") as HTMLInputElement).checked,
    ).toBe(true);
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
    expect(
      (screen.getByLabelText("EU-s cég") as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Kitöltés a NAV-ból" }));
    await waitFor(() =>
      expect(api.nav.lookup).toHaveBeenCalledWith("t", "12345678-2-42"),
    );
  });

  it("EU-s módban országkód nélkül nem menthető", () => {
    renderForm("Valami s.r.o.");
    fireEvent.click(screen.getByLabelText("EU-s cég"));
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

/*
  A MAGANSZEMELY ES A MODOSITAS (Luca, 2026-11-10). MI PIROSIT: a magánszemély kapcsolója nem „Név” feliratot ad; a
  magánszemély COMPANY típussal mentődik (a számla kapuja adószámot kér tőle: nem kiállítható); magánszemélynél adószám
  vagy NAV-gomb marad; a módosítás nem a vevő mostani adataival nyílik; a módosítás új vevőt vesz fel a meglévő frissítése
  helyett, vagy elveszti a vevő eddigi címének azonosítóját, vagy a változásvédő időbélyeget; cégnél a mező továbbra is Cégnév.
*/
describe("Magánszemély és módosítás a számla vevő-űrlapján (Luca, 2026-11-10)", () => {
  beforeEach(() => {
    api.customers.list.mockReset();
    api.customers.create.mockReset();
    api.customers.update.mockReset();
    api.nav.lookup.mockReset();
  });

  it("a magánszemély kapcsolója „Név” feliratot ad, eltünteti az adószám-sort, és PERSON-ként mentődik adószám nélkül", async () => {
    api.customers.create.mockResolvedValue(created);
    const { onSaved } = renderForm("");
    expect(screen.getByLabelText("Cégnév")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Magánszemély"));
    expect(screen.queryByLabelText("Cégnév")).toBeNull();
    expect(screen.queryByLabelText("Adószám")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Kitöltés a NAV-ból" }),
    ).toBeNull();
    for (const [label, value] of [
      ["Név", "Kiss Anna"],
      ["Irányítószám", "1106"],
      ["Város", "Budapest"],
      ["Cím", "Fő utca 1."],
      ["E-mail", "anna@example.hu"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    // nincs azonos-adószám keresés magánszemélynél
    expect(api.customers.list).not.toHaveBeenCalled();
    expect(api.customers.create).toHaveBeenCalledWith("t", {
      type: "PERSON",
      displayName: "Kiss Anna",
      email: "anna@example.hu",
      addresses: [
        {
          type: "BILLING",
          country: "HU",
          postalCode: "1106",
          city: "Budapest",
          line1: "Fő utca 1.",
          isDefault: true,
        },
      ],
    });
  });

  it("a korábban beírt adószám nem megy el és nem keres azonos adószámú vevőt, ha a vevő magánszemély lett", async () => {
    api.customers.create.mockResolvedValue(created);
    const { onSaved } = renderForm("12345678242");
    fireEvent.click(screen.getByLabelText("Magánszemély"));
    for (const [label, value] of [
      ["Név", "Kiss Anna"],
      ["Irányítószám", "1106"],
      ["Város", "Budapest"],
      ["Cím", "Fő utca 1."],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(api.customers.list).not.toHaveBeenCalled();
    expect(api.customers.create.mock.calls[0]![1]).not.toHaveProperty(
      "taxNumber",
    );
  });

  it("a magánszemély kapcsolójának levétele visszaadja a Cégnév feliratot és az adószám-sort", () => {
    renderForm("");
    fireEvent.click(screen.getByLabelText("Magánszemély"));
    fireEvent.click(screen.getByLabelText("Magánszemély"));
    expect(screen.getByLabelText("Cégnév")).toBeTruthy();
    expect(screen.getByLabelText("Adószám")).toBeTruthy();
  });

  const person = {
    id: "c-9",
    customerNumber: "V-9",
    type: "PERSON" as const,
    displayName: "Kiss Anna",
    companyName: null,
    email: "regi@example.hu",
    billingEmail: "szamla@example.hu",
    updatedAt: "2026-11-10T08:00:00.000Z",
    addresses: [
      {
        id: "addr-1",
        type: "BILLING" as const,
        country: "HU",
        postalCode: "1106",
        city: "Budapest",
        line1: "Fő utca 1.",
        isDefault: true,
      },
    ],
  };

  it("a módosítás a vevő mostani adataival nyílik (név, cím, számlázási e-mail), nem üresen", () => {
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={person as never}
        onSaved={vi.fn()}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Vevő adatainak módosítása")).toBeTruthy();
    expect((screen.getByLabelText("Név") as HTMLInputElement).value).toBe(
      "Kiss Anna",
    );
    expect(
      (screen.getByLabelText("Irányítószám") as HTMLInputElement).value,
    ).toBe("1106");
    expect((screen.getByLabelText("Város") as HTMLInputElement).value).toBe(
      "Budapest",
    );
    expect((screen.getByLabelText("Cím") as HTMLInputElement).value).toBe(
      "Fő utca 1.",
    );
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      "szamla@example.hu",
    );
    expect(
      (screen.getByLabelText("Magánszemély") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("a mentés a MEGLÉVŐ vevőt frissíti (azonos cím-azonosítóval és időbélyeggel), nem vesz fel újat", async () => {
    const saved = { ...person, displayName: "Kiss Annamária" };
    api.customers.update.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={person as never}
        onSaved={onSaved}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Kiss Annamária" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(api.customers.create).not.toHaveBeenCalled();
    expect(api.customers.update).toHaveBeenCalledWith("t", "c-9", {
      type: "PERSON",
      displayName: "Kiss Annamária",
      companyName: null,
      taxNumber: null,
      euTaxNumber: null,
      billingEmail: "szamla@example.hu",
      addresses: [
        {
          id: "addr-1",
          type: "BILLING",
          country: "HU",
          postalCode: "1106",
          city: "Budapest",
          line1: "Fő utca 1.",
        },
      ],
      expectedUpdatedAt: "2026-11-10T08:00:00.000Z",
    });
  });

  it("egy meglévő cég módosításánál a Cégnév felirat és a mostani adószám áll, és az adószám-mezők mennek a frissítésben", async () => {
    const company = {
      ...person,
      type: "COMPANY" as const,
      displayName: "Kézi",
      companyName: "Kézi Kft.",
      taxNumber: "12345678-2-42",
    };
    api.customers.update.mockResolvedValue(company);
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={company as never}
        onSaved={vi.fn()}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Cégnév") as HTMLInputElement).value).toBe(
      "Kézi Kft.",
    );
    expect((screen.getByLabelText("Adószám") as HTMLInputElement).value).toBe(
      "12345678-2-42",
    );
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.customers.update).toHaveBeenCalled());
    expect(api.customers.update.mock.calls[0]![2]).toMatchObject({
      type: "COMPANY",
      displayName: "Kézi Kft.",
      companyName: "Kézi Kft.",
      taxNumber: "12345678-2-42",
      euTaxNumber: null,
    });
  });

  it("a változtatás nélküli mentés egyik e-mail-címet sem cseréli ki: a számlázási címbe írja vissza, az általánost nem érinti", async () => {
    const both = {
      ...person,
      email: "info@example.hu",
      billingEmail: "szamla@example.hu",
    };
    api.customers.update.mockResolvedValue(both);
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={both as never}
        onSaved={vi.fn()}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.customers.update).toHaveBeenCalled());
    const body = api.customers.update.mock.calls[0]![2];
    expect(body.billingEmail).toBe("szamla@example.hu");
    expect(body).not.toHaveProperty("email");
  });

  it("számlázási cím nélküli vevőnél az általános címbe ír (onnan olvasott)", async () => {
    const onlyGeneral = {
      ...person,
      email: "info@example.hu",
      billingEmail: null,
    };
    api.customers.update.mockResolvedValue(onlyGeneral);
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={onlyGeneral as never}
        onSaved={vi.fn()}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.customers.update).toHaveBeenCalled());
    const body = api.customers.update.mock.calls[0]![2];
    expect(body.email).toBe("info@example.hu");
    expect(body).not.toHaveProperty("billingEmail");
  });

  it("cégről magánszemélyre váltáskor az adószám törlődik (null), és a felület kimondja", async () => {
    const company = {
      ...person,
      type: "COMPANY" as const,
      displayName: "Kézi",
      companyName: "Kézi Kft.",
      taxNumber: "12345678-2-42",
    };
    api.customers.update.mockResolvedValue({ ...company, type: "PERSON" });
    render(
      <BillingNewCustomerForm
        token="t"
        initialSearch=""
        existing={company as never}
        onSaved={vi.fn()}
        onPickExisting={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Magánszemély"));
    expect(
      screen.getByText(
        /mostani adószáma \(12345678-2-42\) a mentéskor törlődik/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.customers.update).toHaveBeenCalled());
    expect(api.customers.update.mock.calls[0]![2]).toMatchObject({
      type: "PERSON",
      companyName: null,
      taxNumber: null,
      euTaxNumber: null,
    });
  });
});
