import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDetailPage } from "./product-detail-page";

const api = vi.hoisted(() => ({ detail: vi.fn(), updateExtension: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));

const detail: ProductDetail = {
  id: "product-1",
  name: "Reef Salt",
  productType: "PHYSICAL",
  isActive: true,
  archivedAt: null,
  brand: { id: "brand-1", name: "Acme" },
  primaryCategory: {
    id: "category-1",
    name: "Só",
    isPrimary: true,
    sortOrder: 0,
  },
  primarySku: "SALT-1",
  thumbnail: null,
  unasListing: null,
  description: "Tengeri só",
  categories: [],
  images: [],
  channelListings: [],
  variants: [
    {
      id: "variant-1",
      sku: "SALT-1",
      name: null,
      unit: "db",
      isActive: true,
      vatRate: "27",
      manufacturerPartNumber: "MPN-1",
      secondaryUnit: "karton",
      secondaryUnitFactor: "12",
      extension: {
        variantId: "variant-1",
        preferredSupplierId: null,
        defaultPurchaseCurrency: "EUR",
        defaultWarehouseId: null,
        defaultLocationId: null,
        minimumStock: "2",
        optimalStock: "8",
        reorderPoint: "3",
        safetyStock: "1",
        lastPurchaseNetPrice: "10",
        lastPurchaseVatRate: null,
        stockTrackingEnabled: true,
        purchasingDisabled: false,
        phaseOut: false,
        autoReorderEnabled: true,
        internalNote: "Csak belső adat",
        updatedAt: "2026-07-20T10:00:00.000Z",
      },
    },
  ],
  unasMirror: {
    source: "UNAS",
    state: "ACTIVE",
    externalId: "159850145",
    sourceCreatedAt: "2026-07-19T10:00:00.000Z",
    sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
    lastSyncedAt: "2026-07-20T10:00:00.000Z",
    missingSince: null,
    currency: "HUF",
    netPrice: "1000",
    grossPrice: "1270",
    saleNetPrice: null,
    saleGrossPrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    priceDisplay: "normal",
    productUrl: null,
    manufacturerUrl: null,
    minimumOrderQuantity: "1",
    maximumOrderQuantity: null,
    orderQuantityStep: "1",
    lowStockThreshold: "2",
    backorderAllowed: true,
    variantStockEnabled: false,
    reportedStock: "7.5",
    reportedStockSyncedAt: "2026-07-20T10:00:00.000Z",
  },
};

const noExtensionDetail: ProductDetail = {
  ...detail,
  variants: [{ ...detail.variants[0]!, extension: null }],
};

const hufDetail: ProductDetail = {
  ...detail,
  variants: [
    {
      ...detail.variants[0]!,
      extension: {
        ...detail.variants[0]!.extension!,
        defaultPurchaseCurrency: "HUF",
        lastPurchaseNetPrice: "1000",
        lastPurchaseVatRate: "27",
      },
    },
  ],
};

describe("ProductDetailPage mirror ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.params = new URLSearchParams();
    auth.session = {
      id: "session-owner",
      token: "token-owner",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "owner",
        email: "owner@acropora.local",
        displayName: "Owner",
        role: "OWNER",
      },
    };
    api.detail.mockResolvedValue(detail);
    api.updateExtension.mockResolvedValue(detail.variants[0]!.extension);
  });

  it("separates the read-only UNAS mirror from Acropora extension data", async () => {
    render(<ProductDetailPage productId="product-1" />);

    expect(await screen.findByText("UNAS terméktükör")).toBeInTheDocument();
    expect(
      screen.getByText("Product Master adatok · csak olvasható"),
    ).toBeInTheDocument();
    expect(screen.getByText("159850145")).toBeInTheDocument();
    expect(screen.getByText("1270 HUF")).toBeInTheDocument();
    expect(
      screen.getByText("Összehasonlító adat, nem az Acropora készlet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Acropora Product Extension")).toBeInTheDocument();
    expect(screen.getByText("Csak belső adat")).toBeInTheDocument();
  });

  it("edits only the Acropora-owned extension fields", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    fireEvent.change(screen.getByLabelText("Minimumkészlet"), {
      target: { value: "4,5" },
    });
    fireEvent.change(screen.getByLabelText("Belső megjegyzés"), {
      target: { value: "Frissített belső adat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.updateExtension).toHaveBeenCalledWith(
        "token-owner",
        "variant-1",
        expect.objectContaining({
          minimumStock: "4.5",
          internalNote: "Frissített belső adat",
        }),
      ),
    );
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });

  it("visszalépéskor megőrzi a lista szűrt URL-jét a returnTo paraméterből", async () => {
    navigation.params = new URLSearchParams(
      `returnTo=${encodeURIComponent("q=reef&page=3")}`,
    );
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    fireEvent.click(screen.getByRole("button", { name: "Vissza a listához" }));

    expect(navigation.push).toHaveBeenCalledWith("/products?q=reef&page=3");
  });

  it("returnTo paraméter nélkül az alap lista URL-re lép vissza", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    fireEvent.click(screen.getByRole("button", { name: "Vissza a listához" }));

    expect(navigation.push).toHaveBeenCalledWith("/products");
  });

  it("a termékleírást a Képek kártya fölött, külön kártyában jeleníti meg", async () => {
    render(<ProductDetailPage productId="product-1" />);

    const description = await screen.findByText("Termékleírás");
    expect(screen.getByText("Tengeri só")).toBeInTheDocument();
    const images = screen.getByText("Képek");
    expect(
      description.compareDocumentPosition(images) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("mentett beállítás nélkül is kiírja a deviza és ár mezőket üresen", async () => {
    api.detail.mockResolvedValue(noExtensionDetail);
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    expect(
      screen.getByText(
        "Ehhez a változathoz még nincs mentett saját beállítás — az alábbi mezők üresek.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Beszerzési deviza")).toBeInTheDocument();
    expect(screen.getByText("Utolsó beszerzési ár")).toBeInTheDocument();
  });

  it("nem forintos devizánál egyetlen beszerzési ár mezőt mutat", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    expect(screen.getByText("Utolsó beszerzési ár (EUR)")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(
      screen.queryByText("Utolsó beszerzési nettó ár"),
    ).not.toBeInTheDocument();
  });

  it("forintos devizánál nettó, ÁFA és számított bruttó árat mutat", async () => {
    api.detail.mockResolvedValue(hufDetail);
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    expect(screen.getByText("Utolsó beszerzési nettó ár")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("Utolsó beszerzési ÁFA")).toBeInTheDocument();
    expect(screen.getByText("27%")).toBeInTheDocument();
    expect(screen.getByText("Utolsó beszerzési bruttó ár")).toBeInTheDocument();
    expect(screen.getByText("1270.00")).toBeInTheDocument();
  });

  it("nem forintos devizánál egy mezőként menti az utolsó beszerzési árat", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    fireEvent.change(screen.getByLabelText("Utolsó beszerzési ár"), {
      target: { value: "12,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.updateExtension).toHaveBeenCalledWith(
        "token-owner",
        "variant-1",
        expect.objectContaining({
          lastPurchaseNetPrice: "12.5",
          lastPurchaseVatRate: null,
        }),
      ),
    );
  });

  it("HUF devizára váltva a nettó/ÁFA mezőket menti, a bruttót nem", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    fireEvent.change(screen.getByLabelText("Beszerzési deviza"), {
      target: { value: "HUF" },
    });
    expect(
      await screen.findByText("Utolsó beszerzési nettó ár"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Utolsó beszerzési nettó ár"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByLabelText("Utolsó beszerzési ÁFA"), {
      target: { value: "27" },
    });
    expect(await screen.findByText("1270.00 HUF")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.updateExtension).toHaveBeenCalledWith(
        "token-owner",
        "variant-1",
        expect.objectContaining({
          defaultPurchaseCurrency: "HUF",
          lastPurchaseNetPrice: "1000",
          lastPurchaseVatRate: "27",
        }),
      ),
    );
  });
});
