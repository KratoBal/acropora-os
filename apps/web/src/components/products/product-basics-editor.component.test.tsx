import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductBasicsEditor } from "./product-basics-editor";

const api = vi.hoisted(() => ({
  update: vi.fn(),
  detail: vi.fn(),
  categoryOptions: vi.fn(),
  brandOptions: vi.fn(),
  list: vi.fn(),
  barcodes: vi.fn(),
}));
const auth = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("@/lib/api/products", () => ({ productApi: api }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products/product-1",
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        permissions: auth.permissions,
      },
    },
  }),
}));

const product = (overrides: Partial<ProductDetail> = {}): ProductDetail =>
  ({
    id: "product-1",
    name: "Régi név",
    description: "Régi leírás",
    catalogAuthority: "ACROPORA",
    origin: "UNAS",
    primaryCategory: { id: "cat-1", name: "Szivattyúk" },
    webshopSellable: false,
    categories: [],
    variants: [],
    images: [],
    ...overrides,
  }) as unknown as ProductDetail;

beforeEach(() => {
  api.update.mockReset();
  api.detail.mockReset();
  api.categoryOptions.mockReset().mockResolvedValue([
    { id: "cat-1", label: "Szivattyúk" },
    { id: "cat-2", label: "Lehabzók" },
  ]);
  auth.permissions = [];
});

describe("ProductBasicsEditor", () => {
  /**
   * A három mező egy űrlapon megy be, egy mentéssel. Külön-külön ellenőrizve a
   * teszt egy olyan szerkesztővel is átmenne, ami hármat kér és egyet küld.
   */
  it("sends all four fields in one save", async () => {
    api.update.mockResolvedValue(product());
    api.detail.mockResolvedValue(
      product({ name: "Új név", description: "Új leírás" }),
    );
    const onSaved = vi.fn();

    render(
      <ProductBasicsEditor
        token="token-1"
        product={product()}
        canManage
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Új név" },
    });
    fireEvent.change(screen.getByLabelText("Leírás"), {
      target: { value: "Új leírás" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Elsődleges kategória")).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("Elsődleges kategória"), {
      target: { value: "cat-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("token-1", "product-1", {
        name: "Új név",
        description: "Új leírás",
        primaryCategoryId: "cat-2",
        webshopSellable: false,
      }),
    );
  });

  /**
   * A mentés utáni állapotnak VISSZAOLVASOTTNAK kell lennie. Egy szerkesztő,
   * ami a saját mezőit hagyja a képernyőn, ugyanígy nézne ki, és pontosan
   * akkor tévedne, amikor a szerver mást mentett, mint amit küldtünk.
   */
  /**
   * A VÁSÁROLHATÓ JELÖLŐNÉGYZET ÁLLÁSA ELMEGY A SZERVERRE.
   *
   * Ez a mező az ELSŐ írási út a `webshopSellable`-höz: eddig hat helyen
   * szerepelt a fában, mind olvasásként, tehát semmi nem tudta igazra
   * állítani. Ha ez az állítás elesik, a kapcsoló megint csak látszik.
   */
  it("sends the purchasable box the way the user left it", async () => {
    api.update.mockResolvedValue(product());
    api.detail.mockResolvedValue(product({ webshopSellable: true }));
    render(
      <ProductBasicsEditor
        token="token-1"
        product={product()}
        canManage
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Vásárolható a webshopban"));
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        expect.objectContaining({ webshopSellable: true }),
      ),
    );
  });

  /**
   * A JELÖLŐNÉGYZET A TERMÉK ÁLLAPOTÁBÓL INDUL, nem üresen.
   *
   * Enélkül egy már vásárolható termék szerkesztője üres négyzetet mutatna, és
   * az első mentés VISSZAKAPCSOLNÁ a terméket -- csendben, mert a felhasználó
   * ahhoz a mezőhöz hozzá sem nyúlt.
   */
  it("starts from the product's own state, not from unchecked", () => {
    render(
      <ProductBasicsEditor
        token="token-1"
        product={product({ webshopSellable: true })}
        canManage
        onSaved={() => {}}
      />,
    );

    expect(
      (screen.getByLabelText("Vásárolható a webshopban") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("shows what the server gives back, not what was typed", async () => {
    api.update.mockResolvedValue(product());
    const reread = product({ name: "A szerver szerinti név" });
    api.detail.mockResolvedValue(reread);
    const onSaved = vi.fn();

    render(
      <ProductBasicsEditor
        token="token-1"
        product={product()}
        canManage
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Amit begépeltem" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.detail).toHaveBeenCalledWith("token-1", "product-1"),
    );
    expect(onSaved).toHaveBeenCalledWith(reread);
  });

  it("reports a refusal instead of pretending it saved", async () => {
    api.update.mockRejectedValue(new Error("PRODUCT_MANAGED_BY_UNAS"));
    const onSaved = vi.fn();

    render(
      <ProductBasicsEditor
        token="token-1"
        product={product()}
        canManage
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(screen.getByText("PRODUCT_MANAGED_BY_UNAS")).toBeTruthy(),
    );
    expect(api.detail).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("offers nothing without the permission to manage products", () => {
    render(
      <ProductBasicsEditor
        token="token-1"
        product={product()}
        canManage={false}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });
});
