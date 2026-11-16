import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CustomerDetail, Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerDetailPage } from "./customer-detail-page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/vevok/customer-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({
    href: "/vevok",
    fromWithinApp: false,
    goBack: vi.fn(),
  }),
}));

const api = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/api/customers", () => ({ customersApi: api }));
vi.mock("@/lib/api/nav-taxpayer", () => ({
  navTaxpayerApi: { lookup: vi.fn() },
}));
vi.mock("@/lib/api/postal-code", () => ({
  postalCodeApi: { lookup: vi.fn(async () => ({ city: null })) },
}));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Luca",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

/*
  WHAT TURNS THIS RED (acrobot 42510; Luca 2026-11-04: the tax number of an existing customer could not be entered).
  A save that skips the shape check of the tax number (or the EU one); a save that does not carry the version it was
  loaded at (a colleague's change overwritten); every address sent on every save (a stale address overwriting a
  newer one); an address edit that loses the address's id (a duplicate instead of an edit); a partner's customer
  mirror editable here; a UNAS customer without the note about what the next sync overwrites; a person who may not
  manage customers seeing a Save button.
*/
function customer(over: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: "customer-1",
    customerNumber: "VEVO-20261001-AE9D",
    partnerCode: "VEVO-20261001-AE9D",
    source: "MANUAL",
    type: "COMPANY",
    displayName: "Kovács Anna",
    companyName: "Fővárosi Állat- és Növénykert",
    email: "rendeles@allatkert.example",
    billingEmail: "szamla@allatkert.example",
    phone: "+36 1 123 4567",
    isActive: true,
    address: "1146 Budapest, Állatkerti krt. 6",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-11-04T10:00:00.000Z",
    paymentDueDays: null,
    marketingEmailConsent: false,
    marketingSmsConsent: false,
    addresses: [
      {
        id: "addr-bill",
        type: "BILLING",
        country: "HU",
        postalCode: "1146",
        city: "Budapest",
        line1: "Állatkerti krt. 6",
        isDefault: true,
      },
      {
        id: "addr-ship",
        type: "SHIPPING",
        country: "HU",
        postalCode: "1146",
        city: "Budapest",
        line1: "Állatkerti krt. 12",
        isDefault: false,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.detail.mockResolvedValue(customer());
  api.update.mockImplementation(
    async (_t: string, _id: string, input: object) =>
      customer({
        ...(input as object),
        updatedAt: "2026-11-04T11:00:00.000Z",
      } as Partial<CustomerDetail>),
  );
});

const render_ = async () => {
  render(<CustomerDetailPage customerId="customer-1" />);
  await screen.findByLabelText("Adószám");
};
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

describe("a vevő adatlapja", () => {
  it("shows the customer's data, with the number, the type and the source", async () => {
    await render_();
    expect(screen.getByText("Fővárosi Állat- és Növénykert")).toBeTruthy();
    expect(screen.getByText(/VEVO-20261001-AE9D · Cég/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Rendelési e-mail") as HTMLInputElement).value,
    ).toBe("rendeles@allatkert.example");
    expect(
      (screen.getByLabelText("Számlázási cím irányítószám") as HTMLInputElement)
        .value,
    ).toBe("1146");
    expect(
      within(screen.getByTestId("customer-badges")).getByText(
        "Általunk rögzített",
      ),
    ).toBeTruthy();
  });

  it("saves the tax number with the version the page was loaded at, and says it is saved", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Adószám"), {
      target: { value: "15501645242" },
    });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [token, id, input] = api.update.mock.calls[0]!;
    expect([token, id]).toEqual(["token-1", "customer-1"]);
    expect(input).toMatchObject({
      taxNumber: "15501645242",
      expectedUpdatedAt: "2026-11-04T10:00:00.000Z",
    });
    expect(await screen.findByText("A vevő adatai mentve")).toBeTruthy();
  });

  it("refuses a tax number of another shape on the page, and sends nothing", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Adószám"), {
      target: { value: "1234" },
    });
    save();
    expect(
      await screen.findByText(/A magyar adószám nyolc számjegy/),
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  // barracuda, #2164 review: the server lets an old, oddly typed number that is already stored stay (so saving another field
  // is not blocked); the page used to check it unconditionally and the phone number could not be saved at all
  it("saves another field of a customer whose stored tax number is of an old shape, and does not complain about it", async () => {
    for (const stored of ["12 34 56 78-1-42x", "12345678"]) {
      api.update.mockClear();
      api.detail.mockResolvedValue(customer({ taxNumber: stored }));
      await render_();
      fireEvent.change(screen.getByLabelText("Telefonszám"), {
        target: { value: "+36 1 999 9999" },
      });
      save();
      await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/A magyar adószám nyolc számjegy/)).toBeNull();
      // the number was not edited, so the same stored text goes back (the server keeps it as it is)
      expect(api.update.mock.calls[0]![2]).toMatchObject({ taxNumber: stored });
      cleanup();
    }
  });

  it("checks the number again as soon as it is edited, even from an old shape", async () => {
    api.detail.mockResolvedValue(customer({ taxNumber: "12 34 56 78-1-42x" }));
    await render_();
    fireEvent.change(screen.getByLabelText("Adószám"), {
      target: { value: "1234" },
    });
    save();
    expect(
      await screen.findByText(/A magyar adószám nyolc számjegy/),
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("refuses an EU tax number of another shape, and sends nothing", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Közösségi adószám"), {
      target: { value: "12345678" },
    });
    save();
    expect(
      await screen.findByText(/A közösségi adószám országkóddal kezdődik/),
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("sends only the addresses that changed, with their ids", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Számlázási cím utca, házszám"), {
      target: { value: "Állatkerti krt. 6-8." },
    });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2].addresses).toEqual([
      {
        id: "addr-bill",
        type: "BILLING",
        country: "HU",
        postalCode: "1146",
        city: "Budapest",
        line1: "Állatkerti krt. 6-8.",
        line2: null,
      },
    ]);
  });

  it("sends no address at all when none was touched", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Telefonszám"), {
      target: { value: "+36 1 999 9999" },
    });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2]).not.toHaveProperty("addresses");
  });

  it("offers a billing address to a customer that has none, and sends it without an id", async () => {
    api.detail.mockResolvedValue(customer({ addresses: [] }));
    await render_();
    fireEvent.click(
      screen.getByRole("button", { name: "Számlázási cím felvétele" }),
    );
    fireEvent.change(screen.getByLabelText("Számlázási cím irányítószám"), {
      target: { value: "1146" },
    });
    fireEvent.change(screen.getByLabelText("Számlázási cím város"), {
      target: { value: "Budapest" },
    });
    fireEvent.change(screen.getByLabelText("Számlázási cím utca, házszám"), {
      target: { value: "Állatkerti krt. 6" },
    });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [address] = api.update.mock.calls[0]![2].addresses;
    expect(address).toMatchObject({
      type: "BILLING",
      line1: "Állatkerti krt. 6",
    });
    expect(address).not.toHaveProperty("id");
  });

  it("asks for the rest of a half-filled address and sends nothing", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Számlázási cím város"), {
      target: { value: "" },
    });
    save();
    expect(
      await screen.findByText(
        /az irányítószám, a város és az utca is kötelező/,
      ),
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("offers the same-named partner's tax number as a hint, and copies it only when asked", async () => {
    api.detail.mockResolvedValue(
      customer({
        taxNumber: undefined,
        partnerTaxHint: {
          partnerName: "Fővárosi Állat- és Növénykert",
          taxNumber: "15501645-2-41",
        },
      }),
    );
    await render_();
    const hint = screen.getByTestId("partner-tax-hint");
    expect(hint.textContent).toContain("15501645-2-41");
    // nothing is copied by itself
    expect((screen.getByLabelText("Adószám") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.click(within(hint).getByRole("button", { name: "Beírom" }));
    expect((screen.getByLabelText("Adószám") as HTMLInputElement).value).toBe(
      "15501645-2-41",
    );
    expect(screen.queryByTestId("partner-tax-hint")).toBeNull();
  });

  it("shows no hint on a customer that already has a tax number", async () => {
    api.detail.mockResolvedValue(
      customer({
        taxNumber: "12345678-1-42",
        partnerTaxHint: { partnerName: "X Kft.", taxNumber: "15501645-2-41" },
      }),
    );
    await render_();
    expect(screen.queryByTestId("partner-tax-hint")).toBeNull();
  });

  it("shows the tax number field to a person only when the type becomes company", async () => {
    api.detail.mockResolvedValue(
      customer({ type: "PERSON", companyName: undefined }),
    );
    render(<CustomerDetailPage customerId="customer-1" />);
    await screen.findByLabelText("Név");
    expect(screen.queryByLabelText("Adószám")).toBeNull();
    fireEvent.change(screen.getByLabelText("Típus"), {
      target: { value: "COMPANY" },
    });
    expect(screen.getByLabelText("Adószám")).toBeTruthy();
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2].type).toBe("COMPANY");
  });

  it("says what the next UNAS sync overwrites on a customer that came from UNAS, and not on another", async () => {
    api.detail.mockResolvedValue(customer({ source: "UNAS" }));
    await render_();
    expect(screen.getByText("UNAS-ból érkezett vevő")).toBeTruthy();
    expect(screen.getByText(/megmaradnak a UNAS-szinkronnál/)).toBeTruthy();
  });

  it("does not show the UNAS note on a manual customer", async () => {
    await render_();
    expect(screen.queryByText("UNAS-ból érkezett vevő")).toBeNull();
  });

  it("is read-only for a partner's customer mirror: disabled fields, no Save, and where to edit it", async () => {
    api.detail.mockResolvedValue(customer({ partnerMirror: true }));
    await render_();
    expect(screen.getByText("Ez a vevő egy partner vevő-tükre")).toBeTruthy();
    expect(
      (screen.getByLabelText("Adószám") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.queryByRole("button", { name: /NAV lekérdezés/ })).toBeNull();
  });

  /*
    A FIZETÉSI HATÁRIDŐ A VEVŐ ADATLAPJÁN (Balázs 2026-11-11 10:58 UTC: a vevőnél nincs is ilyen mező). MI PIROSÍT: a mező nem mutatja
    a tárolt napot; az üres mező nem törli (null) a tárolt napot; a nulla "nincs"-ként megy el; határon kívüli vagy tört szám elmegy a
    szerverre; a partner tükör-sora szerkeszthető; a lap nem mondja meg, mi az alapérték.
  */
  it("shows the stored payment days, and says what an empty field means", async () => {
    api.detail.mockResolvedValue(customer({ paymentDueDays: 30 }));
    await render_();
    expect(
      (screen.getByLabelText("Fizetési határidő (nap)") as HTMLInputElement)
        .value,
    ).toBe("30");
    expect(
      screen.getByText(
        "Üres: a Partnerek oldalon beállított, ha nincs, 8 nap.",
      ),
    ).toBeTruthy();
  });

  it("saves the payment days as a number; an empty field clears them (null); zero is zero", async () => {
    await render_();
    const field = screen.getByLabelText("Fizetési határidő (nap)");
    fireEvent.change(field, { target: { value: "15" } });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2]).toMatchObject({ paymentDueDays: 15 });

    fireEvent.change(field, { target: { value: "0" } });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(api.update.mock.calls[1]![2]).toMatchObject({ paymentDueDays: 0 });

    fireEvent.change(field, { target: { value: "" } });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(3));
    expect(api.update.mock.calls[2]![2].paymentDueDays).toBeNull();
  });

  it("refuses payment days of another shape on the page (366, -1, 1.5, 1e2, text) and sends nothing", async () => {
    await render_();
    const field = screen.getByLabelText("Fizetési határidő (nap)");
    for (const value of ["366", "-1", "1.5", "1e2", "tizenöt"]) {
      fireEvent.change(field, { target: { value } });
      save();
      expect(
        await screen.findByText(
          "A fizetési határidő 0 és 365 közötti egész szám lehet.",
        ),
        value,
      ).toBeTruthy();
    }
    expect(api.update).not.toHaveBeenCalled();
  });

  it("a partner's customer mirror shows the days but cannot change them, and says where", async () => {
    api.detail.mockResolvedValue(
      customer({ partnerMirror: true, paymentDueDays: 30 }),
    );
    await render_();
    const field = screen.getByLabelText(
      "Fizetési határidő (nap)",
    ) as HTMLInputElement;
    expect(field.value).toBe("30");
    expect(field.disabled).toBe(true);
    expect(screen.getByText("A Partnerek oldalon állítható.")).toBeTruthy();
  });

  it("a user who may only view customers sees the days and cannot change them", async () => {
    auth.role = "VIEWER";
    api.detail.mockResolvedValue(customer({ paymentDueDays: 8 }));
    await render_();
    expect(
      (screen.getByLabelText("Fizetési határidő (nap)") as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("offers no Save to a user who may only view customers", async () => {
    auth.role = "VIEWER";
    await render_();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(
      (screen.getByLabelText("Telefonszám") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("keeps the stale-save sentence and offers a reload instead of overwriting a colleague's change", async () => {
    api.update.mockRejectedValue(
      new Error("A vevőt másik felhasználó módosította. Frissítsd az oldalt."),
    );
    await render_();
    fireEvent.change(screen.getByLabelText("Telefonszám"), {
      target: { value: "+36 1 999 9999" },
    });
    save();
    expect(
      await screen.findByText(/A vevőt másik felhasználó módosította/),
    ).toBeTruthy();
    const detailCalls = api.detail.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Adatok frissítése" }));
    await waitFor(() =>
      expect(api.detail.mock.calls.length).toBeGreaterThan(detailCalls),
    );
  });

  it("clears an emptied optional field with null, not with an empty string", async () => {
    await render_();
    fireEvent.change(screen.getByLabelText("Telefonszám"), {
      target: { value: "" },
    });
    save();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2].phone).toBeNull();
  });
});
