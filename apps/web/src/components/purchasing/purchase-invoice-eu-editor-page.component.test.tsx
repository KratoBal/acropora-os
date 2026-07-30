import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  NavIncomingInvoiceDetail,
  Session,
  SupplierSummary,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseInvoiceEuEditorPage } from "./purchase-invoice-eu-editor-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams("navInvoiceId=nav-invoice-1"),
  push: vi.fn(),
}));

const navApi = vi.hoisted(() => ({
  detail: vi.fn(),
}));

const purchasingApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  getExchangeRate: vi.fn(),
  searchProducts: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

const productApiMock = vi.hoisted(() => ({
  categoryOptions: vi.fn(),
}));

const suppliersApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  search: vi.fn(),
}));

const viesApi = vi.hoisted(() => ({
  check: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
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
  navIncomingInvoicesApi: navApi,
}));

vi.mock("@/lib/api/purchasing", () => ({
  purchasingApi: purchasingApiMock,
}));

vi.mock("@/lib/api/products", () => ({
  productApi: productApiMock,
}));

vi.mock("@/lib/api/suppliers", () => ({
  suppliersApi: suppliersApiMock,
}));

vi.mock("@/lib/api/vies-vat", () => ({
  viesVatApi: viesApi,
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
  },
};

const navDetail: NavIncomingInvoiceDetail = {
  id: "nav-invoice-1",
  navInvoiceNumber: "INV-2026-1",
  supplierTaxNumber: "12345678-2-42",
  supplierName: "Teszt Beszállító Kft.",
  invoiceIssueDate: "2026-07-30T00:00:00.000Z",
  paymentDate: "2026-08-07T00:00:00.000Z",
  currency: "HUF",
  invoiceNetAmount: "10000",
  invoiceVatAmount: "2700",
  insDate: "2026-07-30T00:00:00.000Z",
  status: "DATA_FETCHED",
  suggestedVatRatePercent: "27",
  lines: [
    {
      lineNumber: 1,
      description: "Teszt termék",
      quantity: "1",
      unit: "db",
      unitPrice: "10000",
      lineNetAmount: "10000",
      vatRatePercent: "27",
    },
  ],
};

const supplier: SupplierSummary = {
  id: "supplier-1",
  code: "SUP-0001",
  name: "Teszt Beszállító Kft.",
  taxNumber: "12345678-2-42",
  country: "HU",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  auth.session = ownerSession;
  navigation.params = new URLSearchParams("navInvoiceId=nav-invoice-1");
  navigation.push.mockReset();
  navApi.detail.mockReset().mockResolvedValue(navDetail);
  purchasingApiMock.create.mockReset().mockResolvedValue({
    detail: { id: "purchase-invoice-1", documentNumber: "BEV-0001" },
    successCount: 1,
    failedCount: 0,
    unasQueuedCount: 1,
    localProductCreatedCount: 0,
    projectReservationCount: 0,
  });
  purchasingApiMock.getExchangeRate.mockReset();
  purchasingApiMock.searchProducts.mockReset().mockResolvedValue([]);
  purchasingApiMock.listProjects.mockReset().mockResolvedValue([]);
  purchasingApiMock.createProject.mockReset();
  productApiMock.categoryOptions
    .mockReset()
    .mockResolvedValue([{ id: "category-1", label: "Technika / Szivattyúk" }]);
  suppliersApiMock.create.mockReset();
  suppliersApiMock.search.mockReset().mockResolvedValue({
    items: [supplier],
    pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
  });
  viesApi.check.mockReset();
});

describe("PurchaseInvoiceEuEditorPage NAV bevételezés", () => {
  it("a pénznemet fixen HUF-ként jeleníti meg", async () => {
    render(createElement(PurchaseInvoiceEuEditorPage));

    const currency = await screen.findByRole("textbox", { name: "Pénznem" });
    expect(currency).toHaveValue("HUF");
    expect(currency).toBeDisabled();
  });

  it("a rögzítési kérésben is HUF pénznemet küld", async () => {
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(await screen.findByText(supplier.name));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    expect(purchasingApiMock.create).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({
        source: "HU_NAV",
        currency: "HUF",
        navIncomingInvoiceId: "nav-invoice-1",
      }),
    );
  });

  it("a NAV-sorból új helyi terméket készít és a számlával együtt küldi", async () => {
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Új helyi termék létrehozása",
      }),
    );
    expect(
      screen.getByText(
        "A belső cikkszámot az Acropora OS automatikusan generálja mentéskor.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Új helyi termék cikkszáma" }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Új helyi termék kategóriája",
      }),
      { target: { value: "category-1" } },
    );
    fireEvent.click(await screen.findByText(supplier.name));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    expect(purchasingApiMock.create).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            createLocalProduct: {
              name: "Teszt termék",
              primaryCategoryId: "category-1",
            },
            sourceDescription: "Teszt termék",
          }),
        ],
      }),
    );
  });

  it("a bevételezett mennyiséget projekthez tudja foglalni", async () => {
    purchasingApiMock.listProjects.mockResolvedValue([
      {
        id: "project-1",
        projectNumber: "PRJ-000001",
        name: "Állatkerti projekt",
        status: "ACTIVE",
      },
    ]);
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Új helyi termék létrehozása",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Projekt hozzáadása" }),
    );
    expect(screen.getByRole("combobox", { name: "Projekt" })).toHaveValue(
      "project-1",
    );
    fireEvent.click(await screen.findByText(supplier.name));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    expect(purchasingApiMock.create).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            projectAllocations: [{ projectId: "project-1", quantity: 1 }],
          }),
        ],
      }),
    );
  });
});
