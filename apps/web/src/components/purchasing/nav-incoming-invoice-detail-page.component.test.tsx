import { fireEvent, render, screen } from "@testing-library/react";
import type { NavIncomingInvoiceDetail, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavIncomingInvoiceDetailPage } from "./nav-incoming-invoice-detail-page";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({ detail: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

// a lap a Figma 614:1369 óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/beszerzes/nav-szamlak/nav-1",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/nav-incoming-invoices", () => ({
  navIncomingInvoicesApi: api,
}));

const session = (role: "OWNER" | "VIEWER"): Session => ({
  id: "session",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user",
    email: "user@acropora.local",
    displayName: "Teszt Felhasználó",
    role,
    customerId: null,
    supplierId: null,
  },
});

// kitalált adat
const invoice = (
  over: Partial<NavIncomingInvoiceDetail> = {},
): NavIncomingInvoiceDetail => ({
  id: "nav-1",
  navInvoiceNumber: "KIT-2026/188",
  supplierTaxNumber: "12345678-2-42",
  supplierName: "Kitalált Akvárium Kft.",
  invoiceIssueDate: "2026-10-07T00:00:00.000Z",
  invoiceDeliveryDate: "2026-10-06T00:00:00.000Z",
  paymentDate: "2026-10-21T00:00:00.000Z",
  currency: "HUF",
  invoiceNetAmount: "20000",
  invoiceVatAmount: "5400",
  insDate: "2026-10-07T12:32:00.000Z",
  invoiceOperation: "CREATE",
  status: "DATA_FETCHED",
  supplierId: "supplier-1",
  lines: [
    {
      lineNumber: 1,
      description: "Kitalált só 25 kg",
      quantity: "2",
      unit: "db",
      unitPrice: "10000",
      lineNetAmount: "20000",
      vatRatePercent: "27",
      isCharge: false,
      supplierSku: "KS-11",
    },
  ],
  ...over,
});

beforeEach(() => {
  auth.session = session("OWNER");
  navigation.push.mockReset();
  api.detail.mockReset().mockResolvedValue(invoice());
});

describe("NavIncomingInvoiceDetailPage (Figma 614:1369)", () => {
  it("NAV-DETAIL: the supplier, the invoice data, the line cards, the net total and the booking action", async () => {
    render(
      createElement(NavIncomingInvoiceDetailPage, { navInvoiceId: "nav-1" }),
    );
    expect(await screen.findAllByTestId("nav-szamlasor")).toHaveLength(1);
    expect(screen.getByText("NAV adatkapcsolat")).toBeInTheDocument();
    expect(screen.getByText("Adószám egyezik")).toBeInTheDocument();
    expect(screen.getByText(/^25\s400 HUF$/)).toBeInTheDocument();
    expect(screen.getByText(/szállítói cikkszám KS-11/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Megnyitás" }));
    fireEvent.click(screen.getByRole("button", { name: "Bevételezés" }));
    expect(navigation.push.mock.calls.map(([path]) => path)).toEqual([
      "/partnerek/supplier-1",
      "/beszerzes/uj?navInvoiceId=nav-1",
    ]);
  });

  it("NAV-DETAIL-NOT-BOOKABLE: a storno document, an unknown supplier, or a viewer: no booking", async () => {
    api.detail.mockResolvedValue(
      invoice({
        invoiceOperation: "STORNO",
        originalInvoiceNumber: "KIT-2026/100",
        supplierId: null,
      }),
    );
    render(
      createElement(NavIncomingInvoiceDetailPage, { navInvoiceId: "nav-1" }),
    );
    expect(
      await screen.findByText(/módosító vagy sztornó okirata/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/eredeti számla: KIT-2026\/100/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bevételezés" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Megnyitás" })).toBeNull();
    expect(screen.queryByText("Adószám egyezik")).toBeNull();
  });
});
