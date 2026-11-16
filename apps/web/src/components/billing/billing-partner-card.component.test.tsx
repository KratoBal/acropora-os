import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPartnerCard } from "./billing-partner-card";

const state = vi.hoisted(() => ({ role: "OWNER" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "t",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: state.role,
        customerId: null,
        supplierId: null,
      },
    },
  }),
}));
const api = vi.hoisted(() => ({
  customers: {
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: api.customers }));
vi.mock("@/lib/api/nav-taxpayer", () => ({ navTaxpayerApi: {} }));
vi.mock("@/lib/api/vies-vat", () => ({ viesVatApi: {} }));

describe("A Vevő kártya: új vevő felvétele (acrobot 28105)", () => {
  beforeEach(() => {
    api.customers.list.mockReset();
    api.customers.create.mockReset();
  });

  it("a felvett vevő rögtön a számla vevője lesz", async () => {
    api.customers.list.mockResolvedValue({ items: [] });
    api.customers.create.mockResolvedValue({
      id: "c-new",
      customerNumber: "V-9",
      displayName: "Kézi Kft.",
      companyName: "Kézi Kft.",
      address: "1106 Budapest, Fő utca 1.",
      taxNumber: null,
      email: null,
      paymentDueDays: null,
      partnerTerms: null,
    });
    const onChange = vi.fn();
    render(
      <BillingPartnerCard token="t" customer={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Új vevő felvétele" }));
    for (const [label, value] of [
      ["Cégnév", "Kézi Kft."],
      ["Irányítószám", "1106"],
      ["Város", "Budapest"],
      ["Cím", "Fő utca 1."],
    ])
      fireEvent.change(screen.getByLabelText(label!), {
        target: { value },
      });
    fireEvent.click(
      screen.getByRole("button", { name: "Vevő mentése és kiválasztása" }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c-new", name: "Kézi Kft." }),
        { paymentDueDays: null },
      ),
    );
  });

  it("vevő-jog nélkül nincs új vevő gomb", () => {
    state.role = "VIEWER";
    render(<BillingPartnerCard token="t" customer={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Új vevő felvétele" })).toBe(
      null,
    );
    state.role = "OWNER";
  });
});

/*
  A KIVALASZTOTT VEVO MODOSITASA (Luca, 2026-11-10). MI PIROSIT: az „Adatok szerkesztése” gomb hiányzik vevő-jog mellett;
  megjelenik vevő-jog nélkül vagy partner-tükörnél (ott a partner-törzs a gazda); a gomb nem a vevő mostani adataival
  töltött űrlapot nyitja, hanem üreset; a mentés után a számla vevője nem a módosított adatokat kapja.
*/
describe("A kiválasztott vevő adatainak szerkesztése (Luca, 2026-11-10)", () => {
  const invoiceCustomer = {
    id: "c-9",
    name: "Kiss Anna",
    address: "1106 Budapest, Fő utca 1.",
    taxNumber: null,
    euTaxNumber: null,
    type: "PERSON" as const,
    partnerMirror: false,
    partnerTaxHint: null,
    contactName: null,
    email: "szamla@example.hu",
    internalCode: "V-9",
  };
  const detail = {
    id: "c-9",
    customerNumber: "V-9",
    type: "PERSON" as const,
    displayName: "Kiss Anna",
    companyName: null,
    email: "szamla@example.hu",
    billingEmail: null,
    address: "1106 Budapest, Fő utca 1.",
    updatedAt: "2026-11-10T08:00:00.000Z",
    paymentDueDays: null,
    partnerTerms: null,
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

  beforeEach(() => {
    api.customers.detail.mockReset();
    api.customers.update.mockReset();
  });

  it("a gomb a vevő mostani adataival töltött űrlapot nyit, és a mentés a módosított vevőt adja a számlának", async () => {
    api.customers.detail.mockResolvedValue(detail);
    api.customers.update.mockResolvedValue({
      ...detail,
      displayName: "Kiss Annamária",
    });
    const onChange = vi.fn();
    render(
      <BillingPartnerCard
        token="t"
        customer={invoiceCustomer as never}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Adatok szerkesztése" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Név") as HTMLInputElement).value).toBe(
        "Kiss Anna",
      ),
    );
    expect((screen.getByLabelText("Cím") as HTMLInputElement).value).toBe(
      "Fő utca 1.",
    );
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Kiss Annamária" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c-9", name: "Kiss Annamária" }),
        { paymentDueDays: null },
      ),
    );
    expect(api.customers.update).toHaveBeenCalledTimes(1);
  });

  it("vevő-jog nélkül és partner-tükörnél nincs szerkesztés gomb, a másik partner választása marad", () => {
    state.role = "VIEWER";
    const { unmount } = render(
      <BillingPartnerCard
        token="t"
        customer={invoiceCustomer as never}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Adatok szerkesztése" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Másik partner" })).toBeTruthy();
    unmount();
    state.role = "OWNER";
    render(
      <BillingPartnerCard
        token="t"
        customer={{ ...invoiceCustomer, partnerMirror: true } as never}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Adatok szerkesztése" }),
    ).toBeNull();
  });
});
