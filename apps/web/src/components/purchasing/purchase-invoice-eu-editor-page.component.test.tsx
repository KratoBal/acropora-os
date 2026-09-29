import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  NavIncomingInvoiceDetail,
  Session,
  SupplierInvoiceImportResult,
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
  importSupplierInvoice: vi.fn(),
  productConflicts: vi.fn(),
  suggestLine: vi.fn(),
  getExchangeRate: vi.fn(),
  searchProducts: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

const productApiMock = vi.hoisted(() => ({
  categoryOptions: vi.fn(),
  brandOptions: vi.fn(),
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
    customerId: null,
    supplierId: null,
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
      isCharge: false,
    },
  ],
};

const supplier: SupplierSummary = {
  id: "supplier-1",
  code: "SUP-0001",
  name: "Teszt Beszállító Kft.",
  isSupplier: true,
  isService: false,
  taxNumber: "12345678-2-42",
  country: "HU",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const euSupplier: SupplierSummary = {
  ...supplier,
  id: "supplier-eu-1",
  code: "SUP-EU-0001",
  name: "Német Beszállító GmbH",
  taxNumber: "DE123456789",
  country: "DE",
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
    supplierCodesLearned: 0,
    supplierCodeConflicts: [],
  });
  purchasingApiMock.getExchangeRate.mockReset().mockResolvedValue({
    currency: "EUR",
    quotedDate: new Date().toISOString().slice(0, 10),
    rate: "398.5",
  });
  purchasingApiMock.searchProducts.mockReset().mockResolvedValue([]);
  purchasingApiMock.listProjects.mockReset().mockResolvedValue([]);
  purchasingApiMock.createProject.mockReset();
  productApiMock.categoryOptions
    .mockReset()
    .mockResolvedValue([{ id: "category-1", label: "Technika / Szivattyúk" }]);
  productApiMock.brandOptions
    .mockReset()
    .mockResolvedValue([{ id: "brand-dupla", label: "Dupla Marin" }]);
  purchasingApiMock.productConflicts
    .mockReset()
    .mockResolvedValue({ byEan: null, bySupplierSku: null });
  purchasingApiMock.suggestLine.mockReset().mockResolvedValue({
    enabled: false,
    decisionRunId: null,
    suggestion: null,
    conflict: false,
    blocked: false,
  });
  suppliersApiMock.create.mockReset();
  suppliersApiMock.search.mockReset().mockResolvedValue({
    items: [supplier],
    pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
  });
  viesApi.check.mockReset();
});

describe("PurchaseInvoiceEuEditorPage NAV bevételezés", () => {
  it("üres számlaszámnál piros hibát jelez és a mezőre fókuszál", async () => {
    navigation.params = new URLSearchParams();
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    const invoiceNumber = screen.getByRole("textbox", { name: "Számlaszám" });
    expect(invoiceNumber).toHaveFocus();
    expect(invoiceNumber).toHaveAttribute("aria-invalid", "true");
    expect(invoiceNumber).toHaveAttribute(
      "placeholder",
      "A számlaszám megadása kötelező.",
    );
    expect(invoiceNumber).toHaveClass("border-rose-500");
    expect(
      screen.getByText("A számlaszám megadása kötelező."),
    ).toBeInTheDocument();
    expect(purchasingApiMock.create).not.toHaveBeenCalled();
  });

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

  /** #1199 A-007: a sor a NAV sorszámával megy, a szerver ebből köti a NAV sorhoz. */
  it("a NAV-sorból jött tétel a NAV sorszámát is küldi", async () => {
    navApi.detail.mockResolvedValue({
      ...navDetail,
      lines: navDetail.lines.map((line) => ({ ...line, lineNumber: 7 })),
    });
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(await screen.findByText(supplier.name));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines).toHaveLength(1);
    expect(keres.lines[0]).toMatchObject({
      navLineNumber: 7,
      sourceDescription: "Teszt termék",
    });
  });

  it("a NAV-ból jött díjsor nem kér javaslatot, a termék-sor igen", async () => {
    // Balázs, 2026-09-29 11:49 UTC: a díjsor-szabály minden szállítóra; a
    // NAV-ból jövő "Szállítási díj" eddig termék-javaslatot kért.
    // BEKAPCSOLT javaslat kell: az alapértelmezett `enabled: false` válasz után
    // a szerkesztő több sort nem kérdez, és a teszt a díjsor nélkül is zöld lenne.
    purchasingApiMock.suggestLine.mockResolvedValue({
      enabled: true,
      decisionRunId: null,
      suggestion: null,
      conflict: false,
      blocked: false,
    });
    navApi.detail.mockResolvedValue({
      ...navDetail,
      lines: [
        navDetail.lines[0]!,
        {
          ...navDetail.lines[0]!,
          lineNumber: 2,
          description: "Szállítási díj",
          lineNetAmount: "1500",
          unitPrice: "1500",
          isCharge: true,
        },
      ],
    });
    render(createElement(PurchaseInvoiceEuEditorPage));
    fireEvent.click(await screen.findByText(supplier.name));

    await waitFor(() =>
      expect(purchasingApiMock.suggestLine).toHaveBeenCalledWith(
        "token-owner",
        expect.objectContaining({ description: "Teszt termék" }),
      ),
    );
    // A szerkesztő a sorokat EGYMÁS UTÁN kérdezi: az első hívás után a
    // következő még úton lehet. Hagyjuk lefutni, és csak utána számoljunk --
    // különben a díjsor kérése a számolás után érkezne, és a teszt zöld maradna.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const descriptions = purchasingApiMock.suggestLine.mock.calls.map(
      ([, request]) => (request as { description: string }).description,
    );
    expect(descriptions).toEqual(["Teszt termék"]);
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
              brandId: undefined,
              // #1199 P-026: a new product starts at the Hungarian standard rate
              vatRate: 27,
              ean: undefined,
              supplierSku: undefined,
              webshopDraft: false,
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

  it("EU-s beszerzésnél csak nem magyarországi beszállítót mutat", async () => {
    navigation.params = new URLSearchParams();
    suppliersApiMock.search.mockResolvedValue({
      items: [supplier, euSupplier],
      pagination: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 },
    });
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.change(
      screen.getByRole("textbox", { name: "Beszállító keresése" }),
      {
        target: { value: "Beszállító" },
      },
    );

    await waitFor(() =>
      expect(suppliersApiMock.search).toHaveBeenCalledWith(
        "token-owner",
        "Beszállító",
        "EU",
      ),
    );
    expect(await screen.findByText(euSupplier.name)).toBeInTheDocument();
    expect(screen.queryByText(supplier.name)).not.toBeInTheDocument();
  });

  it("belföldi beszerzésnél csak magyarországi beszállítót mutat", async () => {
    navigation.params = new URLSearchParams();
    suppliersApiMock.search.mockResolvedValue({
      items: [supplier, euSupplier],
      pagination: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 },
    });
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(screen.getByRole("button", { name: "Belföldi (kézi)" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Beszállító keresése" }),
      {
        target: { value: "Beszállító" },
      },
    );

    await waitFor(() =>
      expect(suppliersApiMock.search).toHaveBeenCalledWith(
        "token-owner",
        "Beszállító",
        "DOMESTIC",
      ),
    );
    expect(await screen.findByText(supplier.name)).toBeInTheDocument();
    expect(screen.queryByText(euSupplier.name)).not.toBeInTheDocument();
  });

  it("belföldi új beszállítónál zárolt HU országkódot küld", async () => {
    navigation.params = new URLSearchParams();
    suppliersApiMock.create.mockResolvedValue(supplier);
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(screen.getByRole("button", { name: "Belföldi (kézi)" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Új beszállító létrehozása" }),
    );
    const country = screen.getByRole("textbox", { name: "Ország" });
    expect(country).toHaveValue("HU");
    expect(country).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Beszállító neve" }), {
      target: { value: supplier.name },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Beszállító létrehozása" }),
    );

    await waitFor(() => expect(suppliersApiMock.create).toHaveBeenCalled());
    expect(suppliersApiMock.create).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({ country: "HU" }),
    );
  });

  it("EU-s új beszállítónál az adószámból tölti ki az országkódot", async () => {
    navigation.params = new URLSearchParams();
    suppliersApiMock.create.mockResolvedValue(euSupplier);
    render(createElement(PurchaseInvoiceEuEditorPage));

    fireEvent.click(
      screen.getByRole("button", { name: "Új beszállító létrehozása" }),
    );
    const country = screen.getByRole("textbox", { name: "Ország" });
    expect(country).toHaveValue("");
    expect(country).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Adószám" }), {
      target: { value: "DE123456789" },
    });
    expect(country).toHaveValue("DE");
    fireEvent.change(screen.getByRole("textbox", { name: "Beszállító neve" }), {
      target: { value: euSupplier.name },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Beszállító létrehozása" }),
    );

    await waitFor(() => expect(suppliersApiMock.create).toHaveBeenCalled());
    expect(suppliersApiMock.create).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({
        taxNumber: "DE123456789",
        country: "DE",
      }),
    );
  });
});

/** #1199 P-026: a beszállítói számlafájl csak előtölt, a mentés a régi út. */
describe("PurchaseInvoiceEuEditorPage beszállítói számla betöltése", () => {
  const imported: SupplierInvoiceImportResult = {
    format: "XML",
    supplier: {
      name: "Német Beszállító GmbH",
      vatId: "DE123456789",
      country: "DE",
    },
    invoiceNumber: "990001",
    invoiceDate: "2026-09-25",
    dueDate: "2026-10-02",
    currency: "EUR",
    netTotal: 93.5,
    lines: [
      {
        lineNumber: 1,
        supplierSku: "81593",
        ean: "4011444815934",
        description: "Dupla Marin Coral Plugs 10 St., SB",
        quantity: 3,
        unit: "db",
        unitNet: 4.5,
        discountPercent: null,
        lineNet: 13.5,
        isCharge: false,
      },
      {
        lineNumber: 2,
        supplierSku: "z1",
        ean: null,
        description: "Frachtkosten (anteilig)",
        quantity: 1,
        unit: "db",
        unitNet: 80,
        discountPercent: null,
        lineNet: 80,
        isCharge: true,
      },
    ],
    warnings: [],
  };

  beforeEach(() => {
    navigation.params = new URLSearchParams();
    purchasingApiMock.importSupplierInvoice
      .mockReset()
      .mockResolvedValue(imported);
    suppliersApiMock.search.mockResolvedValue({
      items: [euSupplier],
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    });
  });

  function upload() {
    const input = screen.getByLabelText("Beszállítói számla fájl");
    const file = new File(["<x/>"], "Rechnung.xml", { type: "text/xml" });
    fireEvent.change(input, { target: { files: [file] } });
    return file;
  }

  it("fills the header, the supplier search and the lines, without a product", async () => {
    render(createElement(PurchaseInvoiceEuEditorPage));
    const file = upload();

    await screen.findByText("Számla betöltve XML-ből");
    expect(purchasingApiMock.importSupplierInvoice).toHaveBeenCalledWith(
      "token-owner",
      file,
    );
    expect(screen.getByRole("textbox", { name: "Számlaszám" })).toHaveValue(
      "990001",
    );
    expect(
      screen.getByText("Dupla Marin Coral Plugs 10 St., SB"),
    ).toBeInTheDocument();
    expect(screen.getByText("Beszállítói cikkszám: 81593")).toBeInTheDocument();
    expect(screen.getAllByText("Nincs terméktörzsben")).toHaveLength(2);
    await waitFor(() =>
      expect(suppliersApiMock.search).toHaveBeenCalledWith(
        "token-owner",
        "DE123456789",
        "EU",
      ),
    );
    // a second file cannot overwrite lines someone may have worked on
    expect(screen.getByLabelText("Beszállítói számla fájl")).toBeDisabled();
  });

  it("marks a PDF-read invoice as one to check, with its warnings", async () => {
    purchasingApiMock.importSupplierInvoice.mockResolvedValue({
      ...imported,
      format: "PDF",
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
      ],
    });
    render(createElement(PurchaseInvoiceEuEditorPage));
    upload();

    expect(
      await screen.findByText("PDF-ből olvasva, ellenőrizendő"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/vesd össze a sorokat a számlával/),
    ).toBeInTheDocument();
  });

  it("shows the reader's refusal and fills nothing", async () => {
    purchasingApiMock.importSupplierInvoice.mockRejectedValue(
      new Error(
        "Ez jóváírás, nem számla: beszerzési számlaként nem tölthető be.",
      ),
    );
    render(createElement(PurchaseInvoiceEuEditorPage));
    upload();

    expect(
      await screen.findByText(/Ez jóváírás, nem számla/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nincs terméktörzsben")).not.toBeInTheDocument();
  });

  it("saves through the usual invoice path; the supplier code is not sent", async () => {
    render(createElement(PurchaseInvoiceEuEditorPage));
    upload();
    await screen.findByText("Számla betöltve XML-ből");

    fireEvent.click(await screen.findByText(euSupplier.name));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres).toMatchObject({
      source: "EU",
      supplierId: euSupplier.id,
      supplierInvoiceNumber: "990001",
      currency: "EUR",
    });
    expect(keres.lines).toHaveLength(2);
    expect(keres.lines[0]).toMatchObject({
      sourceDescription: "Dupla Marin Coral Plugs 10 St., SB",
      orderedQuantity: 3,
      unitNet: 4.5,
    });
    expect(keres.lines[0].variantId).toBeUndefined();
    expect(JSON.stringify(keres)).not.toContain("81593");
  });
});

/** #1199 P-026 UJ-TERMEK: új termék a számlasorból, és hogy tényleg új-e. */
describe("PurchaseInvoiceEuEditorPage új termék a számlasorból", () => {
  const imported: SupplierInvoiceImportResult = {
    format: "XML",
    supplier: {
      name: "Német Beszállító GmbH",
      vatId: "DE123456789",
      country: "DE",
    },
    invoiceNumber: "990001",
    invoiceDate: "2026-09-25",
    dueDate: null,
    currency: "EUR",
    netTotal: 13.5,
    lines: [
      {
        lineNumber: 1,
        supplierSku: "81593",
        ean: "4011444815934",
        description: "Dupla Marin Coral Plugs 10 St., SB",
        quantity: 3,
        unit: "db",
        unitNet: 4.5,
        discountPercent: null,
        lineNet: 13.5,
        isCharge: false,
      },
    ],
    warnings: [],
  };

  beforeEach(() => {
    navigation.params = new URLSearchParams();
    purchasingApiMock.importSupplierInvoice
      .mockReset()
      .mockResolvedValue(imported);
    suppliersApiMock.search.mockResolvedValue({
      items: [euSupplier],
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    });
  });

  async function importAndStartNewProduct() {
    render(createElement(PurchaseInvoiceEuEditorPage));
    fireEvent.change(screen.getByLabelText("Beszállítói számla fájl"), {
      target: { files: [new File(["<x/>"], "r.xml", { type: "text/xml" })] },
    });
    await screen.findByText("Számla betöltve XML-ből");
    fireEvent.click(await screen.findByText(euSupplier.name));
    fireEvent.click(
      screen.getByRole("button", { name: "Új helyi termék létrehozása" }),
    );
  }

  it("prefills EAN and supplier code from the invoice and sends the new details", async () => {
    await importAndStartNewProduct();

    expect(screen.getByLabelText("Új helyi termék EAN-je")).toHaveValue(
      "4011444815934",
    );
    expect(
      screen.getByLabelText("Új helyi termék beszállítói cikkszáma"),
    ).toHaveValue("81593");
    await waitFor(() =>
      expect(purchasingApiMock.productConflicts).toHaveBeenCalledWith(
        "token-owner",
        {
          ean: "4011444815934",
          supplierId: euSupplier.id,
          supplierSku: "81593",
        },
      ),
    );
    fireEvent.change(await screen.findByLabelText("Új helyi termék márkája"), {
      target: { value: "brand-dupla" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines[0].createLocalProduct).toEqual({
      name: "Dupla Marin Coral Plugs 10 St., SB",
      primaryCategoryId: undefined,
      brandId: "brand-dupla",
      vatRate: 27,
      ean: "4011444815934",
      supplierSku: "81593",
      // not asked for the webshop: the product stays out of the Medusa projection
      webshopDraft: false,
    });
  });

  it("sends the webshop-draft choice only when it is ticked, and it starts unticked", async () => {
    // Balázs, 2026-09-28 20:53 UTC: into the webshop only if wanted, as a draft.
    await importAndStartNewProduct();
    const box = screen.getByRole("checkbox", {
      name: "Új helyi termék a webshopba is, piszkozatként",
    });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );

    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines[0].createLocalProduct.webshopDraft).toBe(true);
  });

  it("says when the product already exists, and links the line to it", async () => {
    purchasingApiMock.productConflicts.mockResolvedValue({
      byEan: {
        variantId: "variant-plugs",
        sku: "ACR-L-000042",
        productName: "Coral Plugs 10 db",
      },
      bySupplierSku: null,
    });
    await importAndStartNewProduct();

    expect(
      await screen.findByText(
        /Ez az EAN már a „Coral Plugs 10 db” \(ACR-L-000042\) termékhez tartozik/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Kötés a meglévő termékhez" }),
    );
    expect(screen.getByText("Coral Plugs 10 db")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Új helyi termék EAN-je"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );
    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines[0]).toMatchObject({ variantId: "variant-plugs" });
    expect(keres.lines[0].createLocalProduct).toBeUndefined();
  });
});

/** #1199 P-026: javaslat a termék nélküli sorhoz; magától soha nem köt. */
describe("PurchaseInvoiceEuEditorPage sor-javaslat", () => {
  const imported: SupplierInvoiceImportResult = {
    format: "XML",
    supplier: {
      name: "Német Beszállító GmbH",
      vatId: "DE123456789",
      country: "DE",
    },
    invoiceNumber: "990001",
    invoiceDate: "2026-09-25",
    dueDate: null,
    currency: "EUR",
    netTotal: 93.5,
    lines: [
      {
        lineNumber: 1,
        supplierSku: "81593",
        ean: "4011444815934",
        description: "Dupla Marin Coral Plugs 10 St., SB",
        quantity: 3,
        unit: "db",
        unitNet: 4.5,
        discountPercent: null,
        lineNet: 13.5,
        isCharge: false,
      },
      {
        lineNumber: 2,
        supplierSku: "z1",
        ean: null,
        description: "Frachtkosten (anteilig)",
        quantity: 1,
        unit: "db",
        unitNet: 80,
        discountPercent: null,
        lineNet: 80,
        isCharge: true,
      },
    ],
    warnings: [],
  };
  const suggested = (overrides: Record<string, unknown>) => ({
    enabled: true,
    decisionRunId: "run-1",
    suggestion: {
      source: "MAPPING",
      variantId: "variant-plugs",
      sku: "ACR-L-000042",
      productName: "Coral Plugs 10 db",
      confidence: null,
    },
    conflict: false,
    blocked: false,
    ...overrides,
  });

  beforeEach(() => {
    navigation.params = new URLSearchParams();
    purchasingApiMock.importSupplierInvoice
      .mockReset()
      .mockResolvedValue(imported);
    suppliersApiMock.search.mockResolvedValue({
      items: [euSupplier],
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    });
  });

  async function importAndPickSupplier() {
    render(createElement(PurchaseInvoiceEuEditorPage));
    fireEvent.change(screen.getByLabelText("Beszállítói számla fájl"), {
      target: { files: [new File(["<x/>"], "r.xml", { type: "text/xml" })] },
    });
    await screen.findByText("Számla betöltve XML-ből");
    fireEvent.click(await screen.findByText(euSupplier.name));
  }

  function save() {
    fireEvent.click(
      screen.getByRole("button", {
        name: "Számla rögzítése és készlet frissítése",
      }),
    );
  }

  it("asks for the product line once, never for the freight line", async () => {
    purchasingApiMock.suggestLine.mockResolvedValue(suggested({}));
    await importAndPickSupplier();
    await waitFor(() =>
      expect(purchasingApiMock.suggestLine).toHaveBeenCalledTimes(1),
    );
    expect(purchasingApiMock.suggestLine).toHaveBeenCalledWith(
      "token-owner",
      expect.objectContaining({
        supplierId: euSupplier.id,
        description: "Dupla Marin Coral Plugs 10 St., SB",
        supplierSku: "81593",
        ean: "4011444815934",
      }),
    );
  });

  it("accepting fills the line's product, and the save carries the run", async () => {
    purchasingApiMock.suggestLine.mockResolvedValue(suggested({}));
    await importAndPickSupplier();
    expect(
      await screen.findByText(/Javaslat \(beszállítói leképezés\):/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Elfogadom" }));
    expect(screen.getByText("Coral Plugs 10 db")).toBeInTheDocument();
    save();
    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines[0]).toMatchObject({
      variantId: "variant-plugs",
      decisionRunId: "run-1",
      // a linked line carries its supplier code: the server learns from it
      supplierSku: "81593",
    });
    expect(keres.lines[1].decisionRunId).toBeUndefined();
  });

  it("a Jev suggestion shows its confidence; 'Nem ez' hides it and the run still goes with the save", async () => {
    purchasingApiMock.suggestLine.mockResolvedValue(
      suggested({
        suggestion: {
          source: "JEV",
          variantId: "variant-plugs",
          sku: "ACR-L-000042",
          productName: "Coral Plugs 10 db",
          confidence: 0.96,
        },
      }),
    );
    await importAndPickSupplier();
    expect(await screen.findByText(/Javaslat \(Jev\):/)).toBeInTheDocument();
    expect(screen.getByText(/, 96%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nem ez" }));
    expect(screen.queryByText(/Javaslat \(Jev\):/)).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(purchasingApiMock.create).toHaveBeenCalled());
    const [, keres] = purchasingApiMock.create.mock.calls[0] ?? [];
    expect(keres.lines[0].variantId).toBeUndefined();
    expect(keres.lines[0].decisionRunId).toBe("run-1");
  });

  it("names a conflict and a blocked line, and offers nothing", async () => {
    purchasingApiMock.suggestLine.mockResolvedValue(
      suggested({ suggestion: null, conflict: true }),
    );
    await importAndPickSupplier();
    expect(
      await screen.findByText(/Ütközés: a beszállítói leképezés és az EAN/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Elfogadom" }),
    ).not.toBeInTheDocument();
  });

  it("with the pilot off it offers nothing and asks no further", async () => {
    // two product lines: after the first "off" answer the second is not asked
    purchasingApiMock.importSupplierInvoice.mockResolvedValue({
      ...imported,
      lines: [
        imported.lines[0]!,
        {
          ...imported.lines[0]!,
          lineNumber: 3,
          supplierSku: "81594",
          description: "Dupla Marin Coral Plugs 20 St., SB",
        },
      ],
    });
    await importAndPickSupplier();
    await waitFor(() =>
      expect(purchasingApiMock.suggestLine).toHaveBeenCalledTimes(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(purchasingApiMock.suggestLine).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Javaslat \(/)).not.toBeInTheDocument();
  });
});
