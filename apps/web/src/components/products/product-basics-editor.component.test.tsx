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
  it("sends all three fields in one save", async () => {
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
      }),
    );
  });

  /**
   * A mentés utáni állapotnak VISSZAOLVASOTTNAK kell lennie. Egy szerkesztő,
   * ami a saját mezőit hagyja a képernyőn, ugyanígy nézne ki, és pontosan
   * akkor tévedne, amikor a szerver mást mentett, mint amit küldtünk.
   */
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
