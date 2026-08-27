import { fireEvent, render, screen } from "@testing-library/react";
import type { NavIncomingInvoiceListResponse, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavIncomingInvoiceListPage } from "./nav-incoming-invoice-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  sync: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/beszerzes/nav-szamlak",
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
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

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const firstPage: NavIncomingInvoiceListResponse = {
  items: [
    {
      id: "nav-invoice-1",
      navInvoiceNumber: "INV-2026-1",
      supplierTaxNumber: "12345678-2-42",
      supplierName: "Teszt Beszállító Kft.",
      invoiceIssueDate: "2026-07-30T00:00:00.000Z",
      currency: "HUF",
      invoiceNetAmount: "10000",
      insDate: "2026-07-30T00:00:00.000Z",
      status: "NEW",
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: 26,
    totalPages: 2,
  },
};

beforeEach(() => {
  auth.session = ownerSession;
  navigation.params = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
  api.list.mockReset().mockResolvedValue(firstPage);
  api.sync.mockReset();
});

describe("NavIncomingInvoiceListPage", () => {
  it("a Következő gomb megtartja a kért oldalszámot", async () => {
    render(createElement(NavIncomingInvoiceListPage));

    fireEvent.click(await screen.findByRole("button", { name: "Következő" }));

    expect(navigation.replace).toHaveBeenCalledWith(
      "/beszerzes/nav-szamlak?page=2",
    );
  });

  it("állapotszűréskor visszaáll az első oldalra", async () => {
    navigation.params = new URLSearchParams("page=2");
    api.list.mockResolvedValue({
      ...firstPage,
      pagination: { ...firstPage.pagination, page: 2 },
    });

    render(createElement(NavIncomingInvoiceListPage));

    fireEvent.click(await screen.findByRole("button", { name: "Új" }));

    expect(navigation.replace).toHaveBeenCalledWith(
      "/beszerzes/nav-szamlak?page=1&status=NEW",
    );
  });
});
