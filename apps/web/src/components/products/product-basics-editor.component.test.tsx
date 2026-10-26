import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    /*
      A leiras a kozos szerkesztoben all (contenteditable), a parancs a TipTap
      API-jan megy: a billentyu-szimulacio a happy-dom alatt nem hu.
    */
    const leiras = await screen.findByLabelText("Leírás");
    act(() => {
      (
        leiras as HTMLElement & {
          editor: { commands: { setContent(html: string): boolean } };
        }
      ).editor.commands.setContent("<p>Új <strong>leírás</strong></p>");
    });
    /**
     * AZ OPCIÓRA VÁRUNK, NEM A MEZŐRE, és ez a különbség tette billegővé ezt a
     * tesztet 2026-09-01-ig.
     *
     * A „Elsődleges kategória" MEZŐ a kategóriák betöltésétől FÜGGETLENÜL ott
     * van: a `FormField` mindig renderel, és a select üresen is létezik. Egy rá
     * váró `waitFor` tehát AZONNAL teljesül -- nem tud elbukni, tehát nem is
     * véd. A `cat-2` OPCIÓ viszont csak az aszinkron betöltés után jelenik meg.
     *
     * MI TÖRTÉNT NÉLKÜLE: ha a `fireEvent.change` a betöltés ELŐTT futott, a
     * nem létező opcióra a select értéke nem állt be, és a mentés
     * `primaryCategoryId: null`-t küldött `cat-2` helyett. Ugyanaz a kód, két
     * kimenetel, gépsebesség szerint. MÉRVE: függőben hagyott
     * `categoryOptions` ígérettel a teszt pontosan ezzel a különbséggel bukik.
     */
    await screen.findByRole("option", { name: "Lehabzók" });
    fireEvent.change(screen.getByLabelText("Elsődleges kategória"), {
      target: { value: "cat-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("token-1", "product-1", {
        name: "Új név",
        description: "<p>Új <strong>leírás</strong></p>",
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

  /**
   * A LEIRAS CSAK SZERKESZTES UTAN MEGY EL. Egy UNAS-bol atvett leirasban
   * `style` es `div` all; ha a nev mentese a leirast is kuldene, a szerver
   * teljes profilu tisztitoja azt csendben atirna.
   */
  it("leaves the description out of a save that did not touch it", async () => {
    api.update.mockResolvedValue(product());
    api.detail.mockResolvedValue(product());
    render(
      <ProductBasicsEditor
        token="token-1"
        product={product({
          description: '<div style="color:red">UNAS leírás</div>',
        })}
        canManage
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Csak a név" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]?.[2]).not.toHaveProperty("description");
  });

  it("names what the editor cannot keep, and shows the live preview", () => {
    render(
      <ProductBasicsEditor
        token="token-1"
        product={product({
          description:
            '<div style="color:red"><p>UNAS <span class="x">leírás</span></p></div><table><tbody><tr><td>Méret</td><td>20 cm</td></tr></tbody></table>',
        })}
        canManage
        onSaved={() => {}}
      />,
    );

    expect(
      screen.getByText("A mostani leírás egy része nem marad meg"),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(div style, span class\)/)).toBeInTheDocument();
    const elonezet = screen.getByTestId("web-content-preview");
    expect(elonezet).toHaveTextContent("Régi név");
    expect(
      screen.getByRole("tab", { name: "Műszaki adatok" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Leírás" })).toBeInTheDocument();
    expect(screen.getByTestId("web-content-preview-body").innerHTML).toBe(
      "<table><tbody><tr><td>Méret</td><td>20 cm</td></tr></tbody></table>",
    );
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
