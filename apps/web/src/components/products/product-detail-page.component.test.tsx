import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ProductDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDetailPage } from "./product-detail-page";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  updateExtension: vi.fn(),
  update: vi.fn(),
  categoryOptions: vi.fn(),
}));
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
  origin: "UNAS",
  catalogAuthority: "UNAS",
  isActive: true,
  webshopSellable: false,
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
  grossPrice: null,
  saleGrossPrice: null,
  stockOnHand: null,
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
      unasBaseSku: "SKU-1",
      unasVariantValues: null,
      unasReportedStock: "5",
      unasReportedStockSyncedAt: "2026-07-31T10:00:00.000Z",
      barcodes: [
        { id: "barcode-1", code: "5901234123457", isPrimary: true },
        { id: "barcode-2", code: "96385074", isPrimary: false },
      ],
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
    isPackageProduct: false,
    packageComponents: [],
  },
};

const noExtensionDetail: ProductDetail = {
  ...detail,
  variants: [{ ...detail.variants[0]!, extension: null }],
};

const localDetail: ProductDetail = {
  ...detail,
  origin: "LOCAL",
  catalogAuthority: "ACROPORA",
  unasMirror: null,
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

const stockDetail: ProductDetail = {
  ...detail,
  stockOnHand: "24900",
};

const packageDetail: ProductDetail = {
  ...detail,
  stockOnHand: null,
  unasMirror: {
    ...detail.unasMirror!,
    isPackageProduct: true,
    packageComponents: [
      { sku: "COMP-A", qty: "2" },
      { sku: "COMP-B", qty: "0.5" },
    ],
  },
};

const richDescriptionHtml = [
  "<p>Leírás <strong>vastagon</strong> és <em>dőlt</em> szöveggel.</p>",
  "<ul><li>Első tulajdonság</li><li>Második tulajdonság</li></ul>",
  '<a href="https://example.com/adatlap" onclick="alert(1)">Gyártói adatlap</a>',
  '<img src="https://example.com/kep.jpg" onerror="alert(2)" alt="Termékkép" />',
  "<script>alert(3)</script>",
  '<a href="javascript:alert(4)">Veszélyes hivatkozás</a>',
].join("");

const richDescriptionDetail: ProductDetail = {
  ...detail,
  description: richDescriptionHtml,
};

// Finds the <dt>/<dd> pair for a given UNAS mirror field label and scopes
// queries to just that pair, so assertions don't collide with the same
// "10"/"—" text appearing elsewhere on the page (e.g. in the Acropora
// Product Extension editor for the same variant).
const findMirrorField = (label: string) => {
  const dt = screen.getByText(label);
  return within(dt.parentElement as HTMLElement);
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
    api.categoryOptions.mockResolvedValue([]);
  });

  it("separates the read-only UNAS mirror from Acropora extension data", async () => {
    render(<ProductDetailPage productId="product-1" />);

    expect(await screen.findByText("UNAS-termék")).toBeInTheDocument();
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

  /**
   * A szerkesztő megjelenése a TULAJDONJOGON múlik, nem a jogosultságon. Mind a
   * két felét állítjuk: egy webshop-gazdájú terméken nem jelenhet meg, egy
   * átvetten meg kell jelennie. Csak az elsőt nézve egy olyan felület is
   * átmenne, ami sehol nem kínál szerkesztést; csak a másodikat nézve egy
   * olyan, ami mindenhol.
   */
  it("nem kínál szerkesztőt a webshop által gondozott terméken", async () => {
    render(<ProductDetailPage productId="product-1" />);

    expect(await screen.findByText("UNAS-termék")).toBeInTheDocument();
    expect(screen.queryByText("Alapadatok szerkesztése")).toBeNull();
  });

  it("az átvett terméken megjeleníti a három mező szerkesztőjét", async () => {
    api.detail.mockResolvedValue(localDetail);

    render(<ProductDetailPage productId="product-1" />);

    expect(
      await screen.findByText("Alapadatok szerkesztése"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Név")).toBeInTheDocument();
    expect(screen.getByLabelText("Leírás")).toBeInTheDocument();
    expect(screen.getByLabelText("Elsődleges kategória")).toBeInTheDocument();
  });

  it("a helyi terméket külön Acropora OS badge-dzsel jelöli", async () => {
    api.detail.mockResolvedValue(localDetail);

    render(<ProductDetailPage productId="product-1" />);

    expect(
      await screen.findByText("Helyi Acropora OS-termék"),
    ).toBeInTheDocument();
    expect(screen.queryByText("UNAS terméktükör")).not.toBeInTheDocument();
  });

  it("a csomagterméket számított készlettel és komponenslistával jelöli", async () => {
    api.detail.mockResolvedValue(packageDetail);

    render(<ProductDetailPage productId="product-1" />);

    expect(
      await screen.findByText("Számított csomagtermék"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nincs önálló készlet")).toBeInTheDocument();
    expect(screen.getByText("Csomag összetevői")).toBeInTheDocument();
    expect(screen.getByText("COMP-A")).toBeInTheDocument();
    expect(screen.getByText("COMP-B")).toBeInTheDocument();
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

  it("nem mutatja a Minimum mennyiséget és a Lépésközt az UNAS terméktükörben", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    expect(screen.queryByText("Minimum mennyiség")).not.toBeInTheDocument();
    expect(screen.queryByText("Lépésköz")).not.toBeInTheDocument();
  });

  it("az UNAS terméktükörben megjeleníti az utolsó beszerárat a devizájával", async () => {
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    // detail fixture: primarySku "SALT-1" variant extension has
    // lastPurchaseNetPrice "10" / defaultPurchaseCurrency "EUR".
    const field = findMirrorField("Utolsó beszerár");
    expect(field.getByText("10 EUR")).toBeInTheDocument();
  });

  it("az UNAS terméktükörben megjeleníti az Acropora OS készletet", async () => {
    api.detail.mockResolvedValue(stockDetail);
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    const field = findMirrorField("Acropora OS készlet");
    // hu-HU grouping separator character varies by ICU data (space, NBSP,
    // narrow NBSP) - same tolerant pattern used by product-list-page's
    // stock/price assertions, "." here is a regex wildcard not a literal dot.
    expect(field.getByText(/^24.900$/)).toBeInTheDocument();
  });

  it("hiányzó beszerár esetén csak gondolatjelet mutat, önálló deviza nélkül", async () => {
    api.detail.mockResolvedValue(noExtensionDetail);
    render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    const field = findMirrorField("Utolsó beszerár");
    expect(field.getByText("—")).toBeInTheDocument();
    expect(field.queryByText(/EUR|HUF|USD/)).not.toBeInTheDocument();
  });

  it("a termékleírásban megtartja az engedélyezett HTML-formázást", async () => {
    api.detail.mockResolvedValue(richDescriptionDetail);
    const { container } = render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    // Scoped to the rendered description block rather than the whole page:
    // other cards (the barcode list, for one) legitimately contain their own
    // <ul><li>, and this test is about the description's own markup.
    const description = container.querySelector(
      "[data-testid=product-description]",
    );
    expect(description).not.toBeNull();
    expect(description?.querySelector("strong")?.textContent).toBe("vastagon");
    expect(description?.querySelector("em")?.textContent).toBe("dőlt");
    const items = description?.querySelectorAll("ul li") ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("Első tulajdonság");
    expect(items[1]?.textContent).toBe("Második tulajdonság");

    const safeLink = screen.getByText("Gyártói adatlap");
    expect(safeLink.getAttribute("href")).toBe("https://example.com/adatlap");
    expect(safeLink.getAttribute("target")).toBe("_blank");
    expect(safeLink.getAttribute("rel")).toBe("noopener noreferrer");

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/kep.jpg");
    expect(image?.getAttribute("alt")).toBe("Termékkép");
  });

  it("eltávolítja a script, az eseménykezelő és a javascript: URL-eket a leírásból", async () => {
    api.detail.mockResolvedValue(richDescriptionDetail);
    const { container } = render(<ProductDetailPage productId="product-1" />);
    await screen.findByText("UNAS terméktükör");

    const html = container.innerHTML;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(3)");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");

    const dangerousLink = screen.getByText("Veszélyes hivatkozás");
    expect(dangerousLink.hasAttribute("href")).toBe(false);
    expect(dangerousLink.getAttribute("target")).toBe("_blank");

    const safeLink = screen.getByText("Gyártói adatlap");
    expect(safeLink.hasAttribute("onclick")).toBe(false);

    const image = container.querySelector("img");
    expect(image?.hasAttribute("onerror")).toBe(false);
  });
});
