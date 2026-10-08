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
  customers: { list: vi.fn(), create: vi.fn(), detail: vi.fn() },
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
