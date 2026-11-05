import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ProductListResponse, Session } from "@acropora/types";
import { createElement, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductListPage } from "./product-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  categoryOptions: vi.fn(),
  brandOptions: vi.fn(),
  bulkShippingProfiles: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

// a lap a Direction F óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

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

// Mirrors what ProductionAuthAdapter actually returns in production: a
// valid, cookie-authenticated session with no client-readable token at
// all (see apps/web/src/lib/auth/production-auth.ts).
const cookieSession: Session = {
  id: "session-cookie",
  token: undefined,
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

const populatedResponse: ProductListResponse = {
  items: [
    {
      id: "product-1",
      name: "Red Sea ReefMat 500",
      productType: "PHYSICAL",
      origin: "UNAS",
      catalogAuthority: "UNAS",
      isActive: true,
      archivedAt: null,
      primarySku: "RS-RM500",
      brand: { id: "brand-1", name: "Red Sea" },
      primaryCategory: {
        id: "category-1",
        name: "Szűréstechnika",
        isPrimary: true,
        sortOrder: 0,
      },
      thumbnail: {
        id: "image-1",
        url: "https://example.test/reefmat.jpg",
        sortOrder: 0,
        altText: "ReefMat 500",
        title: null,
      },
      unasListing: {
        channel: "UNAS",
        externalStatus: "3",
        isPublished: true,
        slug: "reefmat-500",
        productUrl: null,
        seoTitle: null,
        backorderAllowed: false,
      },
      grossPrice: "24900",
      priceSource: "unas" as const,
      saleGrossPrice: "19900",
      stockOnHand: "12",
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: 51,
    totalPages: 3,
  },
};

function emptyResponse(page = 1): ProductListResponse {
  return {
    items: [],
    pagination: { page, pageSize: 25, totalItems: 0, totalPages: 0 },
  };
}

function setUrl(query = "") {
  navigation.params = new URLSearchParams(query);
  navigation.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  auth.session = ownerSession;
  navigation.params = new URLSearchParams();
  navigation.listeners.clear();
  navigation.replace.mockReset();
  navigation.push.mockReset();
  navigation.replace.mockImplementation((url) => {
    setUrl(url.split("?")[1] ?? "");
  });
  api.list.mockReset();
  api.categoryOptions
    .mockReset()
    .mockResolvedValue([
      { id: "category-1", label: "Technika / Szűréstechnika" },
    ]);
  api.brandOptions
    .mockReset()
    .mockResolvedValue([{ id: "brand-1", label: "Red Sea" }]);
});

describe("ProductListPage", () => {
  it("kezdetben skeleton loading állapotot jelenít meg", () => {
    api.list.mockReturnValue(new Promise(() => undefined));

    render(createElement(ProductListPage));

    expect(screen.getByLabelText("Terméklista betöltése")).toBeInTheDocument();
  });

  it("megjeleníti a betöltött terméklista fő táblázatmezőit", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Red Sea ReefMat 500")).toBeInTheDocument();
    expect(screen.getByText("RS-RM500")).toBeInTheDocument();
    expect(screen.getByText("UNAS-termék")).toBeInTheDocument();
    expect(
      screen.getByRole("table").querySelector("tbody")?.textContent,
    ).toContain("Aktív");
    expect(screen.getByText(/24.900\s?Ft/)).toBeInTheDocument();
    expect(screen.getByText(/19.900\s?Ft/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ReefMat 500" })).toHaveAttribute(
      "src",
      "https://example.test/reefmat.jpg",
    );
  });

  it("a helyi terméket külön Acropora OS badge-dzsel jelöli", async () => {
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...populatedResponse.items[0]!,
          origin: "LOCAL",
          catalogAuthority: "ACROPORA",
        },
      ],
    });

    render(createElement(ProductListPage));

    expect(
      await screen.findByText("Helyi Acropora OS-termék"),
    ).toBeInTheDocument();
  });

  /*
    A KÉP NÉLKÜLI SOR (Balázs briefje, 2026-09-30, 4. pont): nem mindenhol
    ugyanaz a csomag-ikon, hanem kategória-ikon, márka-monogram, és csak a
    végén a generikus. MI PIROSÍT: ha a kategória útját nem olvassa (a márka-
    levél "Fauna Marin" egyedül nem mond csoportot), ha a monogram a kategória
    elé kerül, vagy ha a kategória nevéből márkát gyárt.
  */
  it("a kép nélküli sor a kategória ikonját, a márka monogramját vagy a generikusat kapja, ebben a sorrendben", async () => {
    const base = populatedResponse.items[0]!;
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...base,
          id: "p-icon",
          name: "Fauna Marin Balling Light",
          thumbnail: null,
          brand: { id: "brand-1", name: "Red Sea" },
          primaryCategory: {
            id: "c-fm",
            name: "Fauna Marin",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek", "Nyomelemek", "Fauna Marin"],
          },
        },
        {
          ...base,
          id: "p-mono",
          name: "Red Sea ReefDose 4",
          thumbnail: null,
          brand: { id: "brand-1", name: "Red Sea" },
          primaryCategory: {
            id: "c-root",
            name: "Termékek",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek"],
          },
        },
        {
          ...base,
          id: "p-generic",
          name: "Maxspect tartó",
          thumbnail: null,
          brand: null,
          primaryCategory: {
            id: "c-mx",
            name: "Maxspect",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek", "Maxspect"],
          },
        },
      ],
    });

    render(createElement(ProductListPage));
    await screen.findByText("Fauna Marin Balling Light");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const kinds = rows.map(
      (row) =>
        row
          .querySelector("[data-thumbnail-fallback]")
          ?.getAttribute("data-thumbnail-fallback") ?? "image",
    );
    expect(kinds).toEqual(["icon", "monogram", "generic"]);
    expect(rows[1]).toHaveTextContent("RS");
    // a márkanevű kategóriából nem lesz monogram
    expect(rows[2]).not.toHaveTextContent(/\bMS\b/);
  });

  // stage, 2026-09-30 (acrobot): egy nem betöltődő kép üres négyzet maradt
  // volna. MI PIROSÍT: ha a hibás kép nem esik vissza a kategória-tartalékra.
  it("a nem betöltődő kép a kategória-tartalékra esik vissza, nem marad üres négyzet", async () => {
    const base = populatedResponse.items[0]!;
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...base,
          primaryCategory: {
            id: "c-fish",
            name: "Gébek",
            isPrimary: true,
            sortOrder: 0,
            path: ["Halak", "Gébek"],
          },
        },
      ],
    });
    render(createElement(ProductListPage));
    const image = await screen.findByRole("img", { name: "ReefMat 500" });
    const row = image.closest("tr") as HTMLElement;
    expect(row.querySelector("[data-thumbnail-fallback]")).toBeNull();

    fireEvent.error(image);

    expect(screen.queryByRole("img", { name: "ReefMat 500" })).toBeNull();
    expect(
      row
        .querySelector("[data-thumbnail-fallback]")
        ?.getAttribute("data-thumbnail-fallback"),
    ).toBe("icon");
  });

  /*
    a82ed229, 2b: A SZÁLLÍTÁS OSZLOP ÉS SZŰRŐ. MI PIROSÍT: ha a még nem vizsgált termék ugyanúgy néz ki, mint a
    megvizsgált, korlát nélküli; ha a jelzők nem látszanak; ha a szűrő nem jut el az API-ig.
  */
  it("a Szállítás oszlop: nincs vizsgálva, nincs korlát, és a jelzők rövid neve", async () => {
    const [first] = populatedResponse.items;
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        { ...first!, id: "p-never", shippingFlags: null },
        { ...first!, id: "p-none", shippingFlags: [] },
        {
          ...first!,
          id: "p-heavy",
          shippingFlags: ["isHeavy", "lockerUnsuitable"],
        },
      ],
    });
    render(createElement(ProductListPage));
    // in the table: the filter's options carry the same short names
    const table = await screen.findByRole("table");
    expect(within(table).getByText("nincs vizsgálva")).toBeInTheDocument();
    expect(within(table).getByText("nincs korlát")).toBeInTheDocument();
    expect(within(table).getByText("Nehéz")).toBeInTheDocument();
    expect(within(table).getByText("Automatába nem fér")).toBeInTheDocument();
  });

  it("a Szállítás szűrő az URL-be kerül, és az URL-ből az API-ig jut", async () => {
    navigation.params = new URLSearchParams("szallitas=isHeavy");
    api.list.mockResolvedValue(populatedResponse);
    render(createElement(ProductListPage));
    await screen.findByRole("table");
    expect(api.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shipping: "isHeavy" }),
    );
    fireEvent.change(screen.getByLabelText("Szállítás"), {
      target: { value: "lockerUnsuitable" },
    });
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        expect.stringContaining("szallitas=lockerUnsuitable"),
        expect.anything(),
      ),
    );
  });

  it("az eltérés-szűrő: a URL-ből az API-ig jut, és a választóban saját felirata van (2d)", async () => {
    navigation.params = new URLSearchParams("szallitas=unasDiff");
    api.list.mockResolvedValue(populatedResponse);
    render(createElement(ProductListPage));
    await screen.findByRole("table");
    expect(api.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shipping: "unasDiff" }),
    );
    expect(
      screen.getByRole("option", { name: "Kézi, eltér a UNAS-tól" }),
    ).toBeInTheDocument();
  });

  it("a fejléc és a sor ugyanabból az oszlopból igazodik: a számoszlop mindkettőben jobbra zár", async () => {
    api.list.mockResolvedValue(populatedResponse);
    render(createElement(ProductListPage));
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole(
      "cell",
    );
    expect(headers.map((header) => header.textContent)).toEqual([
      "",
      "Termék",
      "SKU",
      "Bruttó ár",
      "Akciós ár",
      "Készlet",
      "Szállítás",
      "Állapot",
      "Művelet",
    ]);
    const right = (element: HTMLElement) =>
      element.className.split(" ").includes("text-right");
    expect(headers.map(right)).toEqual(cells.map(right));
    expect(headers.map(right)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  // a82ed229, 2c: WHAT TURNS THIS RED: a bulk save that sends a flag nobody touched (it would overwrite the
  // product's own value and turn it MANUAL); a checkbox that opens the product; the selection for a viewer.
  it("a kijelölt termékek szállítási jelzői: csak az átállított jelző megy, és a lista újratölt", async () => {
    api.list.mockResolvedValue(populatedResponse);
    api.bulkShippingProfiles.mockResolvedValue({ updated: 1, notFound: [] });
    render(createElement(ProductListPage));
    const box = await screen.findByRole("checkbox", {
      name: "Red Sea ReefMat 500 kijelölése",
    });
    fireEvent.click(box);
    expect(navigation.push).not.toHaveBeenCalled();
    const bar = screen.getByTestId("product-bulk-bar");
    expect(bar).toHaveTextContent("1 kijelölve");
    fireEvent.click(
      within(bar).getByRole("button", { name: "Szállítási jelzők…" }),
    );
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", {
      name: "Mentés (1 termék)",
    });
    expect(save).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Foxpost nem ajánlható" }),
      { target: { value: "yes" } },
    );
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Nehéz áru" }),
      { target: { value: "no" } },
    );
    // set and set back: "nem változik" again, so it is not sent
    const frozen = within(dialog).getByRole("combobox", {
      name: "Fagyasztott",
    });
    fireEvent.change(frozen, { target: { value: "yes" } });
    fireEvent.change(frozen, { target: { value: "" } });
    const calls = api.list.mock.calls.length;
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.bulkShippingProfiles).toHaveBeenCalledWith(
        "token-owner",
        ["product-1"],
        { foxpostForbidden: true, isHeavy: false },
      ),
    );
    expect(
      await screen.findByText("1 termék szállítási jelzői mentve."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.list.mock.calls.length).toBeGreaterThan(calls),
    );
    expect(screen.queryByTestId("product-bulk-bar")).toBeNull();
  });

  it("ami nem ment át, kijelölve marad, és a lap megmondja (barracuda, #2207)", async () => {
    api.list.mockResolvedValue(populatedResponse);
    api.bulkShippingProfiles.mockResolvedValue({
      updated: 0,
      notFound: [],
      failed: [{ productId: "product-1", reason: "conflict" }],
    });
    render(createElement(ProductListPage));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Red Sea ReefMat 500 kijelölése",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Szállítási jelzők…" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Fagyasztott" }),
      { target: { value: "yes" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Mentés (1 termék)" }),
    );
    expect(
      await screen.findByText(
        /1 termék mentése nem sikerült, ezek kijelölve maradtak/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("product-bulk-bar")).toHaveTextContent(
      "1 kijelölve",
    );
  });

  it("az oldal-kijelölő az oldal összes termékét jelöli, és products.manage nélkül nincs kijelölés", async () => {
    api.list.mockResolvedValue(populatedResponse);
    const { unmount } = render(createElement(ProductListPage));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Az oldal minden termékének kijelölése",
      }),
    );
    expect(screen.getByTestId("product-bulk-bar")).toHaveTextContent(
      "1 kijelölve",
    );
    unmount();
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "WAREHOUSE" },
    };
    render(createElement(ProductListPage));
    await screen.findByRole("table");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("üres katalógus állapotot jelenít meg", async () => {
    api.list.mockResolvedValue(emptyResponse());

    render(createElement(ProductListPage));

    expect(await screen.findByText("A katalógus még üres")).toBeInTheDocument();
  });

  it("szűrés után nincs találat állapotot ad és törli a szűrőket", async () => {
    navigation.params = new URLSearchParams("q=nincs&page=4");
    api.list.mockResolvedValue(emptyResponse());

    render(createElement(ProductListPage));

    expect(await screen.findByText("Nincs találat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/products", {
      scroll: false,
    });
  });

  it("API-hibát jelenít meg és retry-ra új lekérést indít", async () => {
    api.list
      .mockRejectedValueOnce(new Error("A katalógus API nem elérhető."))
      .mockResolvedValueOnce(populatedResponse);

    render(createElement(ProductListPage));

    expect(
      await screen.findByText("A terméklista nem tölthető be"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    expect(await screen.findByText("Red Sea ReefMat 500")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("lapozáskor frissíti az URL-t", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );
    expect(navigation.replace).toHaveBeenCalledWith("/products?page=2", {
      scroll: false,
    });
  });

  it.each([
    ["Aktivitási állapot", "active", "active=true"],
    ["Kategória", "category-1", "categoryId=category-1"],
    ["Márka", "brand-1", "brandId=brand-1"],
  ])(
    "a(z) %s szűrő változásakor page=1-re áll",
    async (label, value, query) => {
      navigation.params = new URLSearchParams("page=3");
      api.list.mockResolvedValue({
        ...populatedResponse,
        pagination: { ...populatedResponse.pagination, page: 3 },
      });

      render(createElement(ProductListPage));
      const select = await screen.findByRole("combobox", { name: label });
      if (label !== "Aktivitási állapot") {
        await waitFor(() => expect(select).toContainHTML(`value=\"${value}\"`));
      }
      fireEvent.change(select, { target: { value } });

      expect(navigation.replace).toHaveBeenLastCalledWith(
        `/products?${query}`,
        { scroll: false },
      );
    },
  );

  it("a keresést debounce után adja át a tipizált API-rétegnek", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    await waitFor(
      () =>
        expect(api.list).toHaveBeenLastCalledWith(
          "token-owner",
          expect.objectContaining({ search: "reef", page: 1 }),
        ),
      { timeout: 1_000 },
    );
  });

  it("termékre kattintva megőrzi a szűrt lista URL-jét returnTo paraméterként", async () => {
    navigation.params = new URLSearchParams("q=reef&page=3");
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(navigation.push).toHaveBeenCalledWith(
      `/products/product-1?returnTo=${encodeURIComponent("q=reef&page=3")}`,
    );
  });

  it("a Részletek gomb is átadja a returnTo paramétert és nem lapoz újra a sorra", async () => {
    navigation.params = new URLSearchParams("categoryId=category-1");
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByRole("button", { name: "Részletek" }));

    expect(navigation.push).toHaveBeenCalledWith(
      `/products/product-1?returnTo=${encodeURIComponent("categoryId=category-1")}`,
    );
  });

  it("szűrők nélkül nem ad hozzá returnTo paramétert", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(navigation.push).toHaveBeenCalledWith("/products/product-1");
  });

  it("products.view jogosultság nélkül megtagadja a hozzáférést", () => {
    auth.session = null;

    render(createElement(ProductListPage));

    expect(
      screen.getByText("Nincs hozzáférésed a termékkatalógushoz"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("cookie-alapú production session esetén (token: undefined) is elindulnak a lekérések, nem ragad be loading állapotban", async () => {
    auth.session = cookieSession;
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ page: 1 }),
    );
    expect(api.categoryOptions).toHaveBeenCalledWith("");
    expect(api.brandOptions).toHaveBeenCalledWith("");
  });
});
